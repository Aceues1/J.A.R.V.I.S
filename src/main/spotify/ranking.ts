// Track ranking, per the guide: among the 10 search candidates, prioritize
// exact artist matches and push covers, remixes, and live versions lower —
// unless the user explicitly asked for one of those.

import type { SpotifyTrack } from './client'

export interface TrackRequest {
  title: string
  artist?: string
  /** Set when the user explicitly asked for a remix/live/cover/acoustic. */
  wantsVariant: boolean
}

const VARIANT_RE = /\b(remix|remixed|live|cover|karaoke|tribute|acoustic|instrumental)\b/i

/** Parse "play [song] by [artist]" targets; the last " by " splits the two. */
export function parseTrackRequest(target: string): TrackRequest {
  const trimmed = target.trim()
  const splitAt = trimmed.toLowerCase().lastIndexOf(' by ')
  const title = splitAt === -1 ? trimmed : trimmed.slice(0, splitAt).trim()
  const artist = splitAt === -1 ? undefined : trimmed.slice(splitAt + 4).trim() || undefined
  return { title, artist, wantsVariant: VARIANT_RE.test(trimmed) }
}

function norm(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

export function scoreTrack(track: SpotifyTrack, request: TrackRequest): number {
  let score = 0
  const title = norm(track.name)
  const wantedTitle = norm(request.title)

  if (title === wantedTitle) score += 3
  else if (title.startsWith(wantedTitle) || title.includes(wantedTitle)) score += 1

  if (request.artist) {
    const wantedArtist = norm(request.artist)
    if (track.artists.some((artist) => norm(artist) === wantedArtist)) {
      score += 5 // exact artist match dominates
    } else if (track.artists.some((artist) => norm(artist).includes(wantedArtist))) {
      score += 2
    } else {
      score -= 3 // wrong artist: likely a cover
    }
  }

  // Covers/remixes/live versions sink unless explicitly requested.
  if (!request.wantsVariant && VARIANT_RE.test(track.name)) score -= 4
  if (!request.wantsVariant && VARIANT_RE.test(track.album)) score -= 1

  // Popularity as a gentle tiebreak only.
  score += track.popularity / 200
  return score
}

/** Best candidate among the (max 10) search results; null when empty. */
export function pickBestTrack(tracks: SpotifyTrack[], request: TrackRequest): SpotifyTrack | null {
  if (tracks.length === 0) return null
  return tracks
    .map((track, index) => ({ track, index, score: scoreTrack(track, request) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)[0].track
}
