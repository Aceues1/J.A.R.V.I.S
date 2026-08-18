import { existsSync, mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearRefreshToken,
  exchangeAuthorizationCode,
  getAccessToken,
  getStoredRefreshToken,
  resetAccessTokenCache,
  storeRefreshToken,
  REFRESH_BUFFER_MS,
  SpotifyAuthError,
  SpotifyConfigError
} from '../tokens'

let file: string

function tokenReply(body: unknown, status = 200): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  file = join(mkdtempSync(join(tmpdir(), 'jarvis-sp-')), 'spotify-auth.json')
  vi.stubEnv('SPOTIFY_TOKEN_PATH', file)
  vi.stubEnv('SPOTIFY_CLIENT_ID', 'client-id-test')
  vi.stubEnv('SPOTIFY_CLIENT_SECRET', 'client-secret-test')
  resetAccessTokenCache()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('refresh-token-only persistence', () => {
  it('stores ONLY the refresh token — never any access token', async () => {
    tokenReply({ access_token: 'AT-secret', expires_in: 3600, refresh_token: 'RT-1' })
    await exchangeAuthorizationCode('auth-code', 'http://127.0.0.1:8888/callback')

    const raw = readFileSync(file, 'utf8')
    expect(raw).toContain('RT-1')
    expect(raw).not.toContain('AT-secret')
    expect(raw).not.toContain('access')
    expect(getStoredRefreshToken()).toBe('RT-1')
  })

  it('clearRefreshToken removes the file and the cached access token', async () => {
    storeRefreshToken('RT-1')
    clearRefreshToken()
    expect(existsSync(file)).toBe(false)
    expect(getStoredRefreshToken()).toBeNull()
  })
})

describe('getAccessToken', () => {
  it('throws SpotifyAuthError when never connected — no network call', async () => {
    const fetchMock = tokenReply({})
    await expect(getAccessToken()).rejects.toThrow(SpotifyAuthError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refreshes with Basic client credentials and caches the access token', async () => {
    storeRefreshToken('RT-1')
    const fetchMock = tokenReply({ access_token: 'AT-1', expires_in: 3600 })
    await expect(getAccessToken()).resolves.toBe('AT-1')
    await expect(getAccessToken()).resolves.toBe('AT-1') // cached — no second call
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/token')
    expect(init.headers.Authorization).toBe(
      `Basic ${Buffer.from('client-id-test:client-secret-test').toString('base64')}`
    )
    expect(String(init.body)).toContain('grant_type=refresh_token')
    expect(String(init.body)).toContain('refresh_token=RT-1')
  })

  it('refreshes again when the token is within the 30-second buffer', async () => {
    storeRefreshToken('RT-1')
    // expires_in of 20s < 30s buffer: every call must refresh.
    const fetchMock = tokenReply({ access_token: 'AT-short', expires_in: 20 })
    await getAccessToken()
    await getAccessToken()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(REFRESH_BUFFER_MS).toBe(30_000)
  })

  it('persists a rotated refresh token from the refresh response', async () => {
    storeRefreshToken('RT-1')
    tokenReply({ access_token: 'AT-1', expires_in: 3600, refresh_token: 'RT-2' })
    await getAccessToken()
    expect(getStoredRefreshToken()).toBe('RT-2')
  })

  it('clears the stored refresh token on 400/401 and demands re-auth', async () => {
    for (const status of [400, 401]) {
      storeRefreshToken('RT-dead')
      resetAccessTokenCache()
      tokenReply({ error: 'invalid_grant' }, status)
      await expect(getAccessToken()).rejects.toThrow(/connect Spotify again/i)
      expect(existsSync(file)).toBe(false) // cleared immediately

      // Next call: no refresh token → fresh OAuth required, no network call.
      const fetchMock = tokenReply({})
      await expect(getAccessToken()).rejects.toThrow('not connected')
      expect(fetchMock).not.toHaveBeenCalled()
    }
  })

  it('throws SpotifyConfigError without client credentials', async () => {
    vi.stubEnv('SPOTIFY_CLIENT_ID', '')
    storeRefreshToken('RT-1')
    await expect(getAccessToken()).rejects.toThrow(SpotifyConfigError)
  })
})
