// Spotify OAuth Authorization Code flow, per the Pro Guide: a TEMPORARY
// loopback HTTP server on port 8888 catches http://127.0.0.1:8888/callback,
// the code is exchanged for tokens, and the server closes. The state
// parameter is random and verified. Only the refresh token is persisted
// (tokens.ts); the browser is opened through the app's existing external
// opener — nothing here touches the renderer.

import { createServer, type Server } from 'http'
import { randomBytes } from 'crypto'
import { exchangeAuthorizationCode, getClientCredentials, SpotifyRequestError } from './tokens'

export const OAUTH_PORT = 8888
export const OAUTH_SCOPES = 'user-read-playback-state user-modify-playback-state'
const FLOW_TIMEOUT_MS = 180_000

function oauthPort(): number {
  const raw = Number(process.env.SPOTIFY_AUTH_PORT)
  return Number.isInteger(raw) && raw > 0 ? raw : OAUTH_PORT
}

export function redirectUri(): string {
  return `http://127.0.0.1:${oauthPort()}/callback`
}

export function buildAuthUrl(state: string): string {
  const { clientId } = getClientCredentials()
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri(),
    scope: OAUTH_SCOPES,
    state
  })
  const base = process.env.SPOTIFY_ACCOUNTS_BASE_URL || 'https://accounts.spotify.com'
  return `${base}/authorize?${params}`
}

const DONE_PAGE =
  '<!doctype html><html><body style="font-family:sans-serif;background:#05080c;color:#9fd8e8;' +
  'display:flex;align-items:center;justify-content:center;height:100vh">' +
  '<div><h2>JARVIS — Spotify connected.</h2><p>You can close this tab and return to JARVIS.</p></div>' +
  '</body></html>'

const FAIL_PAGE = DONE_PAGE.replace('Spotify connected.', 'Spotify authorization failed.').replace(
  'You can close this tab and return to JARVIS.',
  'Close this tab and try again from JARVIS.'
)

let activeFlow: Promise<void> | null = null

/**
 * Run the complete OAuth flow: start the temporary callback server, open the
 * authorization page in the browser, wait for the redirect, verify state,
 * exchange the code, store ONLY the refresh token, and close the server.
 * Concurrent calls share one flow. Resolves on success; rejects on denial,
 * state mismatch, timeout, or exchange failure (server always closed).
 */
export function runOAuthFlow(openExternal: (url: string) => void | Promise<void>): Promise<void> {
  if (activeFlow) return activeFlow
  activeFlow = new Promise<void>((resolve, reject) => {
    const state = randomBytes(16).toString('hex')
    let settled = false
    let server: Server | null = null
    let timer: ReturnType<typeof setTimeout> | null = null

    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      server?.close()
      activeFlow = null
      if (error) reject(error)
      else resolve()
    }

    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${oauthPort()}`)
      if (url.pathname !== '/callback') {
        res.writeHead(404).end()
        return
      }
      const code = url.searchParams.get('code')
      const returnedState = url.searchParams.get('state')
      const oauthError = url.searchParams.get('error')

      if (oauthError || !code || returnedState !== state) {
        res.writeHead(200, { 'Content-Type': 'text/html' }).end(FAIL_PAGE)
        finish(
          new SpotifyRequestError(
            oauthError === 'access_denied'
              ? 'Spotify authorization was declined.'
              : 'Spotify authorization failed (bad callback).'
          )
        )
        return
      }

      res.writeHead(200, { 'Content-Type': 'text/html' }).end(DONE_PAGE)
      exchangeAuthorizationCode(code, redirectUri())
        .then(() => finish())
        .catch((error) => finish(error instanceof Error ? error : new Error('exchange failed')))
    })

    server.on('error', (error) => {
      console.error('[spotify] OAuth callback server error', error)
      finish(
        new SpotifyRequestError('Could not start the Spotify login listener (port 8888 busy?).')
      )
    })

    // Loopback only — never exposed beyond this machine.
    server.listen(oauthPort(), '127.0.0.1', () => {
      timer = setTimeout(
        () => finish(new SpotifyRequestError('Spotify authorization timed out.')),
        FLOW_TIMEOUT_MS
      )
      Promise.resolve(openExternal(buildAuthUrl(state))).catch((error) => {
        console.error('[spotify] failed to open the authorization page', error)
        finish(new SpotifyRequestError('Could not open the Spotify authorization page.'))
      })
    })
  })
  return activeFlow
}
