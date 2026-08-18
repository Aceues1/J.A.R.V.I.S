// Embedded YouTube player plumbing, per the Pro Guide: privacy-oriented
// youtube-nocookie.com embed in a plain iframe, controlled via the raw
// postMessage API — no SDK.

export const YOUTUBE_EMBED_ORIGIN = 'https://www.youtube-nocookie.com'

// The guide's mandatory post-load settle time: the embedded player ignores
// commands sent immediately after the iframe load event. Don't remove it.
export const YOUTUBE_COMMAND_DELAY_MS = 700

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/

export function isValidVideoId(videoId: string): boolean {
  return VIDEO_ID_RE.test(videoId)
}

export function buildEmbedUrl(videoId: string, origin: string = window.location.origin): string {
  if (!isValidVideoId(videoId)) {
    throw new Error('invalid videoId')
  }
  const params = new URLSearchParams({
    autoplay: '1',
    enablejsapi: '1',
    modestbranding: '1',
    rel: '0',
    playsinline: '1',
    controls: '1',
    origin
  })
  return `${YOUTUBE_EMBED_ORIGIN}/embed/${videoId}?${params}`
}

export type PlayerFunc = 'playVideo' | 'pauseVideo' | 'setVolume'

export function buildPlayerCommand(func: PlayerFunc, args: Array<number | string> = []): string {
  return JSON.stringify({ event: 'command', func, args })
}
