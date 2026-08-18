// YouTube search for the in-HUD player, per the Pro Guide: fetch the public
// results page (filtered to videos via sp=EgIQAQ%3D%3D) and extract the first
// videoId from the embedded JSON. No browser automation, no API key, no SDK.
// Runs in the main process; the renderer never fetches YouTube directly.

const DEFAULT_BASE_URL = 'https://www.youtube.com'
const REQUEST_TIMEOUT_MS = 15_000

// A videoId is exactly 11 URL-safe characters; anything else never reaches
// the player iframe URL.
export const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/

export class YouTubeError extends Error {}

export interface VideoResult {
  videoId: string
  title?: string
  thumbnailUrl: string
}

export function extractFirstVideo(html: string): VideoResult | null {
  // The results page embeds ytInitialData; the first videoRenderer is the
  // first organic result.
  const match = html.match(/"videoRenderer":\s*{\s*"videoId":\s*"([A-Za-z0-9_-]{11})"/)
  if (!match) return null
  const videoId = match[1]
  if (!VIDEO_ID_RE.test(videoId)) return null

  // Best-effort title from the same renderer blob; absence is fine.
  let title: string | undefined
  const after = html.slice(match.index ?? 0, (match.index ?? 0) + 4000)
  const titleMatch = after.match(/"title":\s*{\s*"runs":\s*\[\s*{\s*"text":\s*"((?:[^"\\]|\\.)*)"/)
  if (titleMatch) {
    try {
      title = JSON.parse(`"${titleMatch[1]}"`)
    } catch {
      title = undefined
    }
  }

  return { videoId, title, thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` }
}

export async function searchYouTube(query: string): Promise<VideoResult> {
  const trimmed = query.trim()
  if (!trimmed) {
    throw new YouTubeError('No search topic was given.')
  }
  const baseUrl = process.env.YOUTUBE_BASE_URL || DEFAULT_BASE_URL
  const url = `${baseUrl}/results?search_query=${encodeURIComponent(trimmed)}&sp=EgIQAQ%3D%3D`

  let response: Response
  try {
    response = await fetch(url, {
      headers: { 'Accept-Language': 'en-US,en;q=0.9' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      console.error('[youtube] search timed out')
      throw new YouTubeError('The YouTube search timed out.')
    }
    console.error('[youtube] network error', error)
    throw new YouTubeError('YouTube could not be reached.')
  }

  if (!response.ok) {
    console.error('[youtube] search failed with status', response.status)
    throw new YouTubeError(`YouTube returned an error (status ${response.status}).`)
  }

  let html: string
  try {
    html = await response.text()
  } catch (error) {
    console.error('[youtube] unreadable response', error)
    throw new YouTubeError('YouTube returned an unreadable response.')
  }

  const video = extractFirstVideo(html)
  if (!video) {
    console.error('[youtube] no videoId found in results page')
    throw new YouTubeError('No playable result was found.')
  }
  return video
}
