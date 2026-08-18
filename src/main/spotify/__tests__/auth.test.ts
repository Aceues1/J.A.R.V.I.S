import { createServer, type Server } from 'http'
import { existsSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildAuthUrl, runOAuthFlow, OAUTH_PORT, OAUTH_SCOPES } from '../auth'
import { getStoredRefreshToken, resetAccessTokenCache } from '../tokens'

// A real accounts-server mock: exchanges any code for tokens and records the
// request body so the test can verify the exchange parameters.
function startAccountsMock(): Promise<{ server: Server; port: number; bodies: string[] }> {
  const bodies: string[] = []
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let body = ''
      req.on('data', (c) => (body += c.toString('utf8')))
      req.on('end', () => {
        bodies.push(body)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({ access_token: 'AT-1', expires_in: 3600, refresh_token: 'RT-oauth' })
        )
      })
    })
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, port: (server.address() as { port: number }).port, bodies })
    )
  })
}

let accounts: { server: Server; port: number; bodies: string[] }
let tokenFile: string
const CALLBACK_PORT = 18877

beforeEach(async () => {
  accounts = await startAccountsMock()
  tokenFile = join(mkdtempSync(join(tmpdir(), 'jarvis-oauth-')), 'spotify-auth.json')
  vi.stubEnv('SPOTIFY_TOKEN_PATH', tokenFile)
  vi.stubEnv('SPOTIFY_CLIENT_ID', 'client-id-test')
  vi.stubEnv('SPOTIFY_CLIENT_SECRET', 'client-secret-test')
  vi.stubEnv('SPOTIFY_ACCOUNTS_BASE_URL', `http://127.0.0.1:${accounts.port}`)
  vi.stubEnv('SPOTIFY_AUTH_PORT', String(CALLBACK_PORT))
  resetAccessTokenCache()
})

afterEach(() => {
  accounts.server.close()
  vi.unstubAllEnvs()
})

describe('buildAuthUrl', () => {
  it('builds the authorization URL with client id, scopes, state, and the 8888 callback', () => {
    vi.stubEnv('SPOTIFY_AUTH_PORT', '') // default port
    const url = new URL(buildAuthUrl('state-123'))
    expect(url.pathname).toBe('/authorize')
    expect(url.searchParams.get('client_id')).toBe('client-id-test')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('redirect_uri')).toBe(`http://127.0.0.1:${OAUTH_PORT}/callback`)
    expect(url.searchParams.get('scope')).toBe(OAUTH_SCOPES)
    expect(url.searchParams.get('state')).toBe('state-123')
    expect(OAUTH_PORT).toBe(8888)
  })
})

describe('runOAuthFlow', () => {
  it('serves the callback, exchanges the code, stores ONLY the refresh token, closes the server', async () => {
    // The "browser": parse the redirect + state from the auth URL and hit
    // the callback exactly as Spotify would.
    const opener = async (authUrl: string): Promise<void> => {
      const parsed = new URL(authUrl)
      const state = parsed.searchParams.get('state')
      const redirect = parsed.searchParams.get('redirect_uri')
      const response = await fetch(`${redirect}?code=auth-code-1&state=${state}`)
      expect(await response.text()).toContain('Spotify connected')
    }
    await runOAuthFlow(opener)

    expect(getStoredRefreshToken()).toBe('RT-oauth')
    const body = accounts.bodies[0]
    expect(body).toContain('grant_type=authorization_code')
    expect(body).toContain('code=auth-code-1')
    expect(body).toContain(encodeURIComponent(`http://127.0.0.1:${CALLBACK_PORT}/callback`))

    // Server closed: a second full flow works (fresh port to avoid the test
    // fetch pool reusing the closed connection).
    vi.stubEnv('SPOTIFY_AUTH_PORT', String(CALLBACK_PORT + 1))
    await runOAuthFlow(opener)
    expect(accounts.bodies).toHaveLength(2)
  })

  it('rejects on a state mismatch without storing anything', async () => {
    const opener = async (): Promise<void> => {
      await fetch(`http://127.0.0.1:${CALLBACK_PORT}/callback?code=x&state=WRONG`)
    }
    await expect(runOAuthFlow(opener)).rejects.toThrow(/bad callback/i)
    expect(existsSync(tokenFile)).toBe(false)
  })

  it('rejects when the user declines authorization', async () => {
    const opener = async (authUrl: string): Promise<void> => {
      const state = new URL(authUrl).searchParams.get('state')
      await fetch(`http://127.0.0.1:${CALLBACK_PORT}/callback?error=access_denied&state=${state}`)
    }
    await expect(runOAuthFlow(opener)).rejects.toThrow(/declined/i)
    expect(getStoredRefreshToken()).toBeNull()
  })
})
