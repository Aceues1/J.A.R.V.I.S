// Spotify token handling, per the Pro Guide's rules:
//   • ONLY the refresh token is ever persisted (userData/spotify-auth.json)
//   • the access token lives in memory only and is NEVER written to disk
//   • access tokens are refreshed silently before each API call with a
//     30-second expiry buffer
//   • a 400/401 from the token endpoint means the refresh token is dead:
//     it is cleared immediately and the next Spotify call requires a fresh
//     OAuth login
// Client ID and Client Secret come from the environment and exist only in
// this MAIN-process module — they never reach the renderer, IPC, or logs.

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

export const DEFAULT_ACCOUNTS_BASE_URL = 'https://accounts.spotify.com'
export const REFRESH_BUFFER_MS = 30_000
const TOKEN_TIMEOUT_MS = 10_000

export class SpotifyConfigError extends Error {}
export class SpotifyAuthError extends Error {}
export class SpotifyRequestError extends Error {}

let registeredPath: string | null = null

export function registerSpotifyDir(dir: string): void {
  registeredPath = join(dir, 'spotify-auth.json')
}

function resolvePath(): string {
  const path = process.env.SPOTIFY_TOKEN_PATH || registeredPath
  if (!path) throw new SpotifyConfigError('Spotify token storage is not initialized.')
  return path
}

export function getClientCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.SPOTIFY_CLIENT_ID
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new SpotifyConfigError(
      'Spotify is not configured. Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in .env.'
    )
  }
  return { clientId, clientSecret }
}

export function accountsBaseUrl(): string {
  return process.env.SPOTIFY_ACCOUNTS_BASE_URL || DEFAULT_ACCOUNTS_BASE_URL
}

// ---- refresh-token persistence (refresh token ONLY, never access token) ----

export function getStoredRefreshToken(): string | null {
  const path = resolvePath()
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { refreshToken?: unknown }
    return typeof parsed.refreshToken === 'string' && parsed.refreshToken
      ? parsed.refreshToken
      : null
  } catch (error) {
    console.error('[spotify] token file unreadable — treating as logged out', error)
    return null
  }
}

export function storeRefreshToken(refreshToken: string): void {
  const path = resolvePath()
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}`
  // Deliberately ONLY the refresh token — no access token, no expiry, no ids.
  writeFileSync(tmp, JSON.stringify({ version: 1, refreshToken }), 'utf8')
  renameSync(tmp, path)
}

export function clearRefreshToken(): void {
  try {
    const path = resolvePath()
    if (existsSync(path)) unlinkSync(path)
  } catch (error) {
    console.error('[spotify] failed to clear refresh token file', error)
  }
  accessTokenCache = null
}

// ---- in-memory access token (never persisted) ----

let accessTokenCache: { token: string; expiresAt: number } | null = null

/** Test hook: drop the in-memory access token. */
export function resetAccessTokenCache(): void {
  accessTokenCache = null
}

async function callTokenEndpoint(params: URLSearchParams): Promise<{
  access_token: string
  expires_in: number
  refresh_token?: string
}> {
  const { clientId, clientSecret } = getClientCredentials()
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

  let response: Response
  try {
    response = await fetch(`${accountsBaseUrl()}/api/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString(),
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS)
    })
  } catch (error) {
    console.error('[spotify] token endpoint unreachable', error)
    throw new SpotifyRequestError('Spotify could not be reached.')
  }

  if (response.status === 400 || response.status === 401) {
    // Dead grant: for refresh_token grants the stored token is now useless —
    // clear it so the next call triggers a fresh OAuth login.
    if (params.get('grant_type') === 'refresh_token') {
      console.error(`[spotify] refresh token rejected (${response.status}) — clearing it`)
      clearRefreshToken()
      throw new SpotifyAuthError(
        'Your Spotify login has expired, sir — I need you to connect Spotify again.'
      )
    }
    throw new SpotifyAuthError(`Spotify rejected the authorization (status ${response.status}).`)
  }
  if (!response.ok) {
    console.error('[spotify] token endpoint HTTP', response.status)
    throw new SpotifyRequestError(`Spotify token request failed (status ${response.status}).`)
  }

  let data: unknown
  try {
    data = await response.json()
  } catch {
    throw new SpotifyRequestError('Spotify returned an unreadable token response.')
  }
  const { access_token, expires_in, refresh_token } = data as Record<string, unknown>
  if (typeof access_token !== 'string' || !access_token) {
    throw new SpotifyRequestError('Spotify returned no access token.')
  }
  return {
    access_token,
    expires_in: typeof expires_in === 'number' ? expires_in : 3600,
    refresh_token: typeof refresh_token === 'string' ? refresh_token : undefined
  }
}

/** Exchange an authorization code (OAuth callback) for tokens. */
export async function exchangeAuthorizationCode(code: string, redirectUri: string): Promise<void> {
  const data = await callTokenEndpoint(
    new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri })
  )
  if (!data.refresh_token) {
    throw new SpotifyRequestError('Spotify returned no refresh token.')
  }
  storeRefreshToken(data.refresh_token)
  accessTokenCache = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 }
}

/**
 * Return a valid access token, silently refreshing when the cached one is
 * missing or within 30 seconds of expiry. Throws SpotifyAuthError when no
 * (valid) refresh token exists — the caller should start OAuth.
 */
export async function getAccessToken(): Promise<string> {
  if (accessTokenCache && accessTokenCache.expiresAt - Date.now() > REFRESH_BUFFER_MS) {
    return accessTokenCache.token
  }
  const refreshToken = getStoredRefreshToken()
  if (!refreshToken) {
    throw new SpotifyAuthError('Spotify is not connected yet.')
  }
  const data = await callTokenEndpoint(
    new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken })
  )
  // Spotify may rotate the refresh token; persist the newest one (only).
  if (data.refresh_token) storeRefreshToken(data.refresh_token)
  accessTokenCache = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 }
  return accessTokenCache.token
}

export function isSpotifyConfigured(): boolean {
  return Boolean(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET)
}

export function isSpotifyConnected(): boolean {
  try {
    return getStoredRefreshToken() !== null
  } catch {
    return false
  }
}
