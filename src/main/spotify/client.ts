// Spotify Web API client (MAIN process only). Every call silently obtains a
// fresh-enough access token first (30s buffer, tokens.ts). Search always
// uses limit=10 exactly, per the guide. Player errors are mapped to honest,
// speakable messages — including the no-active-device case.

import { getAccessToken, SpotifyAuthError, SpotifyRequestError } from './tokens'

const DEFAULT_API_BASE_URL = 'https://api.spotify.com'
const REQUEST_TIMEOUT_MS = 10_000
export const SEARCH_LIMIT = 10

export interface SpotifyTrack {
  uri: string
  name: string
  artists: string[]
  album: string
  popularity: number
  durationMs: number
}

export interface SpotifyDevice {
  id: string
  name: string
  isActive: boolean
  volumePercent: number | null
}

export interface PlaybackState {
  isPlaying: boolean
  trackName: string | null
  artists: string[]
  deviceName: string | null
  volumePercent: number | null
}

function apiBaseUrl(): string {
  return process.env.SPOTIFY_API_BASE_URL || DEFAULT_API_BASE_URL
}

async function apiRequest(
  method: 'GET' | 'PUT' | 'POST',
  path: string,
  body?: unknown
): Promise<unknown | null> {
  const token = await getAccessToken()
  let response: Response
  try {
    response = await fetch(`${apiBaseUrl()}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
  } catch (error) {
    console.error('[spotify] API unreachable', error)
    throw new SpotifyRequestError('Spotify could not be reached.')
  }

  if (response.status === 204) return null
  if (response.status === 401) {
    throw new SpotifyAuthError('Spotify rejected the session — please connect Spotify again.')
  }
  if (response.status === 403) {
    throw new SpotifyRequestError('Spotify Premium is required for playback control, sir.')
  }
  if (response.status === 404) {
    throw new SpotifyRequestError(
      'Spotify reports no active device — open Spotify on a device first.'
    )
  }
  if (!response.ok) {
    console.error('[spotify] API HTTP', response.status, path)
    throw new SpotifyRequestError(`Spotify returned an error (status ${response.status}).`)
  }
  const text = await response.text().catch(() => '')
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    throw new SpotifyRequestError('Spotify returned an unreadable response.')
  }
}

/** Track search — exactly limit=10 candidates, never more. */
export async function searchTracks(query: string): Promise<SpotifyTrack[]> {
  const params = new URLSearchParams({ q: query, type: 'track', limit: String(SEARCH_LIMIT) })
  const data = (await apiRequest('GET', `/v1/search?${params}`)) as {
    tracks?: { items?: unknown[] }
  } | null
  const items = data?.tracks?.items
  if (!Array.isArray(items)) return []
  const tracks: SpotifyTrack[] = []
  for (const raw of items) {
    const item = raw as Record<string, unknown>
    const artists = Array.isArray(item.artists)
      ? item.artists
          .map((a) => (a as { name?: unknown })?.name)
          .filter((n): n is string => typeof n === 'string')
      : []
    if (typeof item.uri !== 'string' || typeof item.name !== 'string') continue
    tracks.push({
      uri: item.uri,
      name: item.name,
      artists,
      album: ((item.album as { name?: unknown })?.name as string) ?? '',
      popularity: typeof item.popularity === 'number' ? item.popularity : 0,
      durationMs: typeof item.duration_ms === 'number' ? item.duration_ms : 0
    })
  }
  return tracks
}

export async function getDevices(): Promise<SpotifyDevice[]> {
  const data = (await apiRequest('GET', '/v1/me/player/devices')) as {
    devices?: unknown[]
  } | null
  if (!Array.isArray(data?.devices)) return []
  return data.devices
    .map((raw) => {
      const device = raw as Record<string, unknown>
      if (typeof device.id !== 'string') return null
      return {
        id: device.id,
        name: typeof device.name === 'string' ? device.name : 'Unknown device',
        isActive: device.is_active === true,
        volumePercent: typeof device.volume_percent === 'number' ? device.volume_percent : null
      }
    })
    .filter((device): device is SpotifyDevice => device !== null)
}

/** Prefer the active device; fall back to the first available; null if none. */
export function chooseDevice(devices: SpotifyDevice[]): SpotifyDevice | null {
  return devices.find((device) => device.isActive) ?? devices[0] ?? null
}

export async function playTrack(uri: string, deviceId: string): Promise<void> {
  await apiRequest('PUT', `/v1/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
    uris: [uri]
  })
}

export async function pausePlayback(): Promise<void> {
  await apiRequest('PUT', '/v1/me/player/pause')
}

export async function resumePlayback(): Promise<void> {
  await apiRequest('PUT', '/v1/me/player/play')
}

export async function nextTrack(): Promise<void> {
  await apiRequest('POST', '/v1/me/player/next')
}

export async function previousTrack(): Promise<void> {
  await apiRequest('POST', '/v1/me/player/previous')
}

export async function setVolume(percent: number, deviceId?: string): Promise<void> {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)))
  const device = deviceId ? `&device_id=${encodeURIComponent(deviceId)}` : ''
  await apiRequest('PUT', `/v1/me/player/volume?volume_percent=${clamped}${device}`)
}

export async function getPlaybackState(): Promise<PlaybackState | null> {
  const data = (await apiRequest('GET', '/v1/me/player')) as Record<string, unknown> | null
  if (!data) return null
  const item = data.item as Record<string, unknown> | undefined
  const device = data.device as Record<string, unknown> | undefined
  const artists = Array.isArray(item?.artists)
    ? item.artists
        .map((a) => (a as { name?: unknown })?.name)
        .filter((n): n is string => typeof n === 'string')
    : []
  return {
    isPlaying: data.is_playing === true,
    trackName: typeof item?.name === 'string' ? item.name : null,
    artists,
    deviceName: typeof device?.name === 'string' ? device.name : null,
    volumePercent: typeof device?.volume_percent === 'number' ? device.volume_percent : null
  }
}
