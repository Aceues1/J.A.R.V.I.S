// Spotify executors — called by the action router. Each command obtains a
// device honestly (active preferred, first available otherwise, honest
// message when none), performs the API call, then pushes the fresh playback
// state to the renderer so the now-playing display updates in real time.
// A missing login starts the OAuth flow in the background and says so —
// nothing ever pretends to have played anything.

import {
  chooseDevice,
  getDevices,
  getPlaybackState,
  nextTrack,
  pausePlayback,
  playTrack,
  previousTrack,
  resumePlayback,
  searchTracks,
  setVolume,
  type PlaybackState
} from './client'
import { parseTrackRequest, pickBestTrack } from './ranking'
import { isSpotifyConfigured, SpotifyAuthError, SpotifyConfigError } from './tokens'
import { runOAuthFlow } from './auth'

export { registerSpotifyDir } from './tokens'

export const VOLUME_STEP = 10

export interface SpotifyActionResult {
  ok: boolean
  message: string
}

// ---- renderer state push (registered by main/index.ts) ----

type StatePush = (state: PlaybackState | null) => void
let pushState: StatePush = () => {}

export function registerSpotifyStatePush(push: StatePush): void {
  pushState = push
}

// ---- browser opener (the app's existing external opener) ----

type Opener = (url: string) => void | Promise<void>
let openExternal: Opener = () => {
  throw new SpotifyConfigError('No browser opener registered.')
}

export function registerSpotifyOpener(opener: Opener): void {
  openExternal = opener
}

async function broadcastState(): Promise<void> {
  try {
    pushState(await getPlaybackState())
  } catch (error) {
    console.error('[spotify] state push failed', error)
  }
}

function notConnectedMessage(): string {
  // Start OAuth in the background (temporary server on 8888 + browser page);
  // the reply is immediate and honest — nothing has played yet.
  runOAuthFlow(openExternal)
    .then(() => console.log('[spotify] OAuth completed — refresh token stored'))
    .catch((error) => console.error('[spotify] OAuth failed:', error?.message ?? error))
  return (
    "I've opened Spotify authorization in your browser, sir — approve it there, " +
    'then ask me again.'
  )
}

function mapError(error: unknown): SpotifyActionResult {
  if (error instanceof SpotifyConfigError) {
    return { ok: false, message: 'Spotify is not configured on this machine yet, sir.' }
  }
  if (error instanceof SpotifyAuthError) {
    if (!isSpotifyConfigured()) {
      return { ok: false, message: 'Spotify is not configured on this machine yet, sir.' }
    }
    return { ok: false, message: notConnectedMessage() }
  }
  const message = error instanceof Error ? error.message : 'Spotify request failed.'
  return { ok: false, message }
}

const NO_DEVICE_MESSAGE =
  "I couldn't find any Spotify device, sir — open Spotify on your PC or phone first, then ask again."

export async function executePlayMusic(target: string, say?: string): Promise<SpotifyActionResult> {
  const request = parseTrackRequest(target)
  if (!request.title) {
    return { ok: false, message: 'Which song would you like, sir?' }
  }
  try {
    const query = request.artist ? `${request.title} artist:${request.artist}` : request.title
    let tracks = await searchTracks(query)
    if (tracks.length === 0 && request.artist) {
      // artist: field filter can be too strict — retry as free text
      tracks = await searchTracks(`${request.title} ${request.artist}`)
    }
    const track = pickBestTrack(tracks, request)
    if (!track) {
      return { ok: false, message: `I couldn't find "${request.title}" on Spotify, sir.` }
    }
    const device = chooseDevice(await getDevices())
    if (!device) {
      return { ok: false, message: NO_DEVICE_MESSAGE }
    }
    await playTrack(track.uri, device.id)
    await broadcastState()
    return {
      ok: true,
      message: say || `Playing ${track.name} by ${track.artists.join(', ')} on ${device.name}, sir.`
    }
  } catch (error) {
    return mapError(error)
  }
}

async function simpleCommand(
  action: () => Promise<void>,
  successMessage: string
): Promise<SpotifyActionResult> {
  try {
    await action()
    await broadcastState()
    return { ok: true, message: successMessage }
  } catch (error) {
    return mapError(error)
  }
}

export function executePauseMusic(say?: string): Promise<SpotifyActionResult> {
  return simpleCommand(pausePlayback, say || 'Paused, sir.')
}

export function executeResumeMusic(say?: string): Promise<SpotifyActionResult> {
  return simpleCommand(resumePlayback, say || 'Resuming, sir.')
}

export function executeNextTrack(say?: string): Promise<SpotifyActionResult> {
  return simpleCommand(nextTrack, say || 'Skipping ahead, sir.')
}

export function executePreviousTrack(say?: string): Promise<SpotifyActionResult> {
  return simpleCommand(previousTrack, say || 'Going back a track, sir.')
}

export async function executeVolumeStep(direction: 1 | -1): Promise<SpotifyActionResult> {
  try {
    const state = await getPlaybackState()
    let current = state?.volumePercent ?? null
    let deviceId: string | undefined
    if (current === null) {
      const device = chooseDevice(await getDevices())
      if (!device) return { ok: false, message: NO_DEVICE_MESSAGE }
      current = device.volumePercent ?? 50
      deviceId = device.id
    }
    const target = Math.max(0, Math.min(100, current + direction * VOLUME_STEP))
    await setVolume(target, deviceId)
    await broadcastState()
    return { ok: true, message: `Volume at ${target} percent, sir.` }
  } catch (error) {
    return mapError(error)
  }
}
