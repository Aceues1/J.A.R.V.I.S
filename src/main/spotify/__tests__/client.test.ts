import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  chooseDevice,
  getDevices,
  getPlaybackState,
  pausePlayback,
  playTrack,
  searchTracks,
  setVolume,
  SEARCH_LIMIT
} from '../client'
import { resetAccessTokenCache, storeRefreshToken } from '../tokens'

interface Route {
  match: (url: string) => boolean
  status?: number
  body?: unknown
}

/** URL-routed fetch stub that also serves the token endpoint. */
function stubApi(routes: Route[]): Array<{ url: string; init: RequestInit }> {
  const calls: Array<{ url: string; init: RequestInit }> = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init: RequestInit = {}) => {
      const url = String(input)
      calls.push({ url, init })
      if (url.includes('/api/token')) {
        return {
          ok: true,
          status: 200,
          json: () => Promise.resolve({ access_token: 'AT-1', expires_in: 3600 }),
          text: () => Promise.resolve('')
        }
      }
      for (const route of routes) {
        if (route.match(url)) {
          const status = route.status ?? 200
          const text = route.body === undefined ? '' : JSON.stringify(route.body)
          return {
            ok: status >= 200 && status < 300,
            status,
            json: () => Promise.resolve(route.body),
            text: () => Promise.resolve(text)
          }
        }
      }
      throw new TypeError(`no route for ${url}`)
    })
  )
  return calls
}

beforeEach(() => {
  vi.stubEnv('SPOTIFY_TOKEN_PATH', join(mkdtempSync(join(tmpdir(), 'jarvis-cl-')), 'auth.json'))
  vi.stubEnv('SPOTIFY_CLIENT_ID', 'cid')
  vi.stubEnv('SPOTIFY_CLIENT_SECRET', 'csec')
  vi.stubEnv('SPOTIFY_API_BASE_URL', 'https://api.spotify.test')
  vi.stubEnv('SPOTIFY_ACCOUNTS_BASE_URL', 'https://accounts.spotify.test')
  resetAccessTokenCache()
  storeRefreshToken('RT-1')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('searchTracks', () => {
  it('always requests exactly limit=10 with a bearer token', async () => {
    const calls = stubApi([
      {
        match: (u) => u.includes('/v1/search'),
        body: {
          tracks: {
            items: [
              {
                uri: 'spotify:track:1',
                name: 'Song A',
                artists: [{ name: 'Artist A' }],
                album: { name: 'Album A' },
                popularity: 80,
                duration_ms: 200000
              }
            ]
          }
        }
      }
    ])
    const tracks = await searchTracks('song a artist:Artist A')
    expect(tracks).toHaveLength(1)
    expect(tracks[0]).toEqual({
      uri: 'spotify:track:1',
      name: 'Song A',
      artists: ['Artist A'],
      album: 'Album A',
      popularity: 80,
      durationMs: 200000
    })

    const searchCall = calls.find((c) => c.url.includes('/v1/search'))!
    const params = new URL(searchCall.url).searchParams
    expect(params.get('limit')).toBe('10')
    expect(SEARCH_LIMIT).toBe(10)
    expect(params.get('type')).toBe('track')
    expect((searchCall.init.headers as Record<string, string>).Authorization).toBe('Bearer AT-1')
  })

  it('returns empty on malformed search payloads', async () => {
    stubApi([{ match: (u) => u.includes('/v1/search'), body: { unexpected: true } }])
    await expect(searchTracks('x')).resolves.toEqual([])
  })
})

describe('devices', () => {
  const devices = [
    { id: 'd1', name: 'Desktop', is_active: false, volume_percent: 40 },
    { id: 'd2', name: 'Phone', is_active: true, volume_percent: 70 }
  ]

  it('parses the device list and prefers the ACTIVE device', async () => {
    stubApi([{ match: (u) => u.includes('/v1/me/player/devices'), body: { devices } }])
    const list = await getDevices()
    expect(list).toHaveLength(2)
    expect(chooseDevice(list)?.id).toBe('d2') // active wins
  })

  it('falls back to the first device when none is active, null when none exist', () => {
    expect(
      chooseDevice([
        { id: 'a', name: 'A', isActive: false, volumePercent: null },
        { id: 'b', name: 'B', isActive: false, volumePercent: null }
      ])?.id
    ).toBe('a')
    expect(chooseDevice([])).toBeNull()
  })
})

describe('player endpoints and error mapping', () => {
  it('maps 404 to the honest no-active-device message', async () => {
    stubApi([{ match: (u) => u.includes('/v1/me/player/pause'), status: 404, body: {} }])
    await expect(pausePlayback()).rejects.toThrow(/no active device.*open Spotify on a device/i)
  })

  it('maps 403 to the Premium-required message', async () => {
    stubApi([{ match: (u) => u.includes('/v1/me/player/play'), status: 403, body: {} }])
    await expect(playTrack('spotify:track:1', 'd1')).rejects.toThrow(/Premium is required/i)
  })

  it('treats 204 No Content as success / empty playback state', async () => {
    stubApi([{ match: (u) => u.includes('/v1/me/player'), status: 204 }])
    await expect(getPlaybackState()).resolves.toBeNull()
  })

  it('clamps volume to 0..100 in the request', async () => {
    const calls = stubApi([{ match: (u) => u.includes('/v1/me/player/volume'), status: 204 }])
    await setVolume(150)
    await setVolume(-20)
    const volumes = calls
      .filter((c) => c.url.includes('volume_percent'))
      .map((c) => new URL(c.url).searchParams.get('volume_percent'))
    expect(volumes).toEqual(['100', '0'])
  })

  it('parses a full playback state', async () => {
    stubApi([
      {
        match: (u) => u.includes('/v1/me/player'),
        body: {
          is_playing: true,
          item: { name: 'Song A', artists: [{ name: 'Artist A' }, { name: 'Artist B' }] },
          device: { name: 'Desktop', volume_percent: 55 }
        }
      }
    ])
    await expect(getPlaybackState()).resolves.toEqual({
      isPlaying: true,
      trackName: 'Song A',
      artists: ['Artist A', 'Artist B'],
      deviceName: 'Desktop',
      volumePercent: 55
    })
  })
})
