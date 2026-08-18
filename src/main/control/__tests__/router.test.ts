import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerScreenCapturer, routeReply } from '../router'
import { registerExternalOpener } from '../websites'
import { registerSpotifyOpener, registerSpotifyStatePush } from '../../spotify'
import { resetAccessTokenCache } from '../../spotify/tokens'

const appsFile = (() => {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-router-'))
  const file = join(dir, 'apps.json')
  writeFileSync(
    file,
    JSON.stringify({
      apps: [
        {
          id: 'testapp',
          name: 'TestApp',
          aliases: ['testapp', 'test app'],
          candidates: [process.execPath],
          args: ['-e', 'setTimeout(() => {}, 30)']
        },
        { id: 'ghost', name: 'GhostApp', aliases: ['ghost'], candidates: ['/missing/ghost.exe'] }
      ]
    })
  )
  return file
})()

const YT_HTML =
  '<html><script>var ytInitialData = {"contents":[{"videoRenderer":{"videoId":"dQw4w9WgXcQ",' +
  '"title":{"runs":[{"text":"Test Video Title"}]}}}]};</script></html>'

function mockJsonFetch(status: number, body: unknown): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
    json: () =>
      typeof body === 'string' ? Promise.reject(new Error('not json')) : Promise.resolve(body)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const screens = [{ label: 'Display 1 of 1, primary', dataUrl: 'data:image/jpeg;base64,aGVsbG8=' }]

beforeEach(() => {
  vi.stubEnv('GROQ_API_KEY', 'test-key')
  vi.stubEnv('JARVIS_APPS_PATH', appsFile)
  registerScreenCapturer(async () => screens)
  registerExternalOpener(() => Promise.resolve())
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('routeReply', () => {
  it('passes plain conversation through untouched', async () => {
    const reply = 'Certainly, sir. Canberra is the capital.'
    const routed = await routeReply(reply, 'capital of australia?')
    expect(routed.text).toBe(reply)
    expect(routed.player).toBeUndefined()
  })

  it('executes a successful open_app and uses the model confirmation', async () => {
    const routed = await routeReply(
      '{"action":"open_app","target":"testapp","say":"Opening TestApp, sir."}',
      'open testapp'
    )
    expect(routed.text).toBe('Opening TestApp, sir.')
  })

  it('reports a missing executable honestly instead of claiming success', async () => {
    const routed = await routeReply(
      '{"action":"open_app","target":"ghost","say":"Opening GhostApp, sir."}',
      'open ghost'
    )
    expect(routed.text).toContain("I wasn't able to open GhostApp")
    expect(routed.text).toContain('path was not found')
  })

  it('reports unknown apps as not in the registry', async () => {
    const routed = await routeReply('{"action":"open_app","target":"photoshop"}', 'open photoshop')
    expect(routed.text).toContain('application registry')
  })

  it('opens allowlisted websites and refuses unknown ones', async () => {
    const ok = await routeReply('{"action":"open_website","target":"youtube"}', 'open youtube')
    expect(ok.text).toBe('Opening YouTube, sir.')

    const bad = await routeReply(
      '{"action":"open_website","target":"https://evil.example.com"}',
      'open evil'
    )
    expect(bad.text).toContain('approved website list')
  })

  it('answers unsupported actions with a clean failure, never silence', async () => {
    const routed = await routeReply('{"action":"format_disk"}', 'format my disk')
    expect(routed.text).toContain("isn't supported")
  })

  it('runs the full screen-analysis path: capture → vision → text', async () => {
    const fetchMock = mockJsonFetch(200, {
      choices: [{ message: { content: 'You are looking at a code editor, sir.' } }]
    })
    const routed = await routeReply('{"action":"analyze_screen"}', 'what am I looking at?')
    expect(routed.text).toBe('You are looking at a code editor, sir.')

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.messages[1].content[1].image_url.url).toBe('data:image/jpeg;base64,aGVsbG8=')
  })

  it('reports capture and vision failures honestly without crashing', async () => {
    registerScreenCapturer(async () => {
      throw new Error('capture blew up')
    })
    const captureFail = await routeReply('{"action":"analyze_screen"}', 'look at my screen')
    expect(captureFail.text).toContain("wasn't able to capture the screen")

    registerScreenCapturer(async () => screens)
    mockJsonFetch(500, { error: 'down' })
    const visionFail = await routeReply('{"action":"analyze_screen"}', 'look at my screen')
    expect(visionFail.text).toContain("couldn't complete the screen analysis")
  })

  it('play_video searches YouTube and attaches a load directive on success', async () => {
    const fetchMock = mockJsonFetch(200, YT_HTML)
    const routed = await routeReply(
      '{"action":"play_video","target":"iron man","say":"Certainly, sir. I\'ll find one."}',
      'play a video about iron man'
    )
    expect(routed.text).toBe("Certainly, sir. I'll find one.")
    expect(routed.player).toEqual({
      kind: 'load',
      videoId: 'dQw4w9WgXcQ',
      title: 'Test Video Title'
    })
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('/results?search_query=iron%20man')
    expect(url).toContain('sp=EgIQAQ%3D%3D')
  })

  it('play_video reports honestly when no result is extractable — no directive', async () => {
    mockJsonFetch(200, '<html>no videos here</html>')
    const routed = await routeReply('{"action":"play_video","target":"x"}', 'play a video')
    expect(routed.text).toContain("couldn't identify a playable result")
    expect(routed.player).toBeUndefined()
  })

  it('play_video reports network failure honestly — no directive', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
    const routed = await routeReply('{"action":"play_video","target":"x"}', 'play a video')
    expect(routed.text).toContain('unable to reach YouTube')
    expect(routed.player).toBeUndefined()
  })

  it('pause and resume produce player directives with truthful text', async () => {
    const paused = await routeReply('{"action":"pause_video"}', 'pause the video')
    expect(paused.player).toEqual({ kind: 'pause' })
    const resumed = await routeReply('{"action":"resume"}', 'resume')
    expect(resumed.player).toEqual({ kind: 'play' })
  })

  it('set_volume validates and clamps to 0–100', async () => {
    for (const [vol, expected] of [
      [0, 0],
      [50, 50],
      [100, 100],
      [150, 100],
      [-5, 0]
    ] as const) {
      const routed = await routeReply(
        JSON.stringify({ action: 'set_volume', volume: vol }),
        'set volume'
      )
      expect(routed.player).toEqual({ kind: 'volume', value: expected })
    }
  })

  it('set_volume accepts a numeric target and rejects non-numeric values', async () => {
    const viaTarget = await routeReply('{"action":"set_volume","target":"40"}', 'volume 40')
    expect(viaTarget.player).toEqual({ kind: 'volume', value: 40 })

    const bad = await routeReply('{"action":"set_volume","target":"loud"}', 'volume loud')
    expect(bad.player).toBeUndefined()
    expect(bad.text).toContain('between 0 and 100')
  })
})

describe('routeReply — Spotify actions', () => {
  const statePushes: unknown[] = []

  function stubSpotifyApi(
    overrides: Record<string, { status?: number; body?: unknown }> = {}
  ): void {
    vi.stubEnv('SPOTIFY_TOKEN_PATH', spotifyTokenFile)
    vi.stubEnv('SPOTIFY_CLIENT_ID', 'cid')
    vi.stubEnv('SPOTIFY_CLIENT_SECRET', 'csec')
    writeFileSync(spotifyTokenFile, JSON.stringify({ version: 1, refreshToken: 'RT-router' }))
    resetAccessTokenCache()
    statePushes.length = 0
    registerSpotifyStatePush((state) => statePushes.push(state))

    const routes: Array<[string, { status?: number; body?: unknown }]> = [
      ['/api/token', { body: { access_token: 'AT-r', expires_in: 3600 } }],
      [
        '/v1/search',
        {
          body: {
            tracks: {
              items: [
                {
                  uri: 'spotify:track:cover',
                  name: 'Bohemian Rhapsody',
                  artists: [{ name: 'Tribute Band' }],
                  album: { name: 'Covers' },
                  popularity: 95
                },
                {
                  uri: 'spotify:track:real',
                  name: 'Bohemian Rhapsody',
                  artists: [{ name: 'Queen' }],
                  album: { name: 'A Night at the Opera' },
                  popularity: 80
                }
              ]
            }
          }
        }
      ],
      [
        '/v1/me/player/devices',
        { body: { devices: [{ id: 'd1', name: 'Desktop', is_active: true, volume_percent: 50 }] } }
      ],
      ['/v1/me/player/play', { status: 204 }],
      ['/v1/me/player/pause', { status: 204 }],
      ['/v1/me/player/volume', { status: 204 }],
      [
        '/v1/me/player',
        {
          body: {
            is_playing: true,
            item: { name: 'Bohemian Rhapsody', artists: [{ name: 'Queen' }] },
            device: { name: 'Desktop', volume_percent: 50 }
          }
        }
      ]
    ]
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input)
        for (const [needle, base] of routes) {
          if (!url.includes(needle)) continue
          const override = Object.entries(overrides).find(([key]) => url.includes(key))?.[1]
          const route = override ?? base
          const status = route.status ?? 200
          const text = route.body === undefined ? '' : JSON.stringify(route.body)
          return {
            ok: status >= 200 && status < 300,
            status,
            json: () => Promise.resolve(route.body),
            text: () => Promise.resolve(text)
          }
        }
        throw new TypeError(`no route for ${url}`)
      })
    )
  }

  const spotifyTokenFile = join(mkdtempSync(join(tmpdir(), 'jarvis-router-sp-')), 'auth.json')

  it('play_music searches, ranks the real artist above the cover, plays, and pushes state', async () => {
    stubSpotifyApi()
    const routed = await routeReply(
      '{"action":"play_music","target":"Bohemian Rhapsody by Queen"}',
      'play bohemian rhapsody by queen'
    )
    expect(routed.text).toBe('Playing Bohemian Rhapsody by Queen on Desktop, sir.')
    // Now-playing state was pushed to the renderer after the change.
    expect(statePushes.length).toBeGreaterThan(0)
    expect((statePushes[0] as { trackName: string }).trackName).toBe('Bohemian Rhapsody')
  })

  it('reports honestly when no Spotify device exists', async () => {
    stubSpotifyApi({ '/v1/me/player/devices': { body: { devices: [] } } })
    const routed = await routeReply(
      '{"action":"play_music","target":"Bohemian Rhapsody by Queen"}',
      'play bohemian rhapsody'
    )
    expect(routed.text).toContain('open Spotify on your PC or phone first')
  })

  it('pause and volume-up commands execute and stay truthful', async () => {
    stubSpotifyApi()
    const paused = await routeReply('{"action":"pause_music"}', 'pause the music')
    expect(paused.text).toBe('Paused, sir.')

    const louder = await routeReply('{"action":"music_volume_up"}', 'volume up')
    expect(louder.text).toBe('Volume at 60 percent, sir.') // 50 + 10
  })

  it('asks for a fresh login when the refresh token is rejected', async () => {
    vi.stubEnv('SPOTIFY_AUTH_PORT', '18899')
    stubSpotifyApi({ '/api/token': { status: 400, body: { error: 'invalid_grant' } } })
    registerSpotifyOpener(() => Promise.resolve())
    const routed = await routeReply('{"action":"pause_music"}', 'pause the music')
    expect(routed.text).toMatch(/authorization in your browser|connect Spotify/i)

    // The reply started a background OAuth flow (temp server on 18899);
    // cancel it via a bad-state callback so nothing outlives the test.
    vi.unstubAllGlobals()
    await new Promise((r) => setTimeout(r, 50))
    await fetch('http://127.0.0.1:18899/callback?state=cancel').catch(() => {})
    await new Promise((r) => setTimeout(r, 50))
  })
})
