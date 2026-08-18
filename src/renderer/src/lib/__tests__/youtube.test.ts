import { describe, expect, it } from 'vitest'
import {
  buildEmbedUrl,
  buildPlayerCommand,
  isValidVideoId,
  YOUTUBE_COMMAND_DELAY_MS,
  YOUTUBE_EMBED_ORIGIN
} from '../youtube'

describe('isValidVideoId', () => {
  it('accepts exactly 11 URL-safe characters and nothing else', () => {
    expect(isValidVideoId('dQw4w9WgXcQ')).toBe(true)
    expect(isValidVideoId('a-b_c123XYZ')).toBe(true)
    expect(isValidVideoId('short')).toBe(false)
    expect(isValidVideoId('waytoolongvideoid')).toBe(false)
    expect(isValidVideoId('bad/../\\id')).toBe(false)
    expect(isValidVideoId('')).toBe(false)
  })
})

describe('buildEmbedUrl', () => {
  it('builds the exact guide-mandated youtube-nocookie embed URL', () => {
    const url = buildEmbedUrl('dQw4w9WgXcQ', 'http://127.0.0.1:5555')
    const parsed = new URL(url)

    expect(parsed.origin).toBe('https://www.youtube-nocookie.com')
    expect(parsed.pathname).toBe('/embed/dQw4w9WgXcQ')
    expect(parsed.searchParams.get('autoplay')).toBe('1')
    expect(parsed.searchParams.get('enablejsapi')).toBe('1')
    expect(parsed.searchParams.get('modestbranding')).toBe('1')
    expect(parsed.searchParams.get('rel')).toBe('0')
    expect(parsed.searchParams.get('playsinline')).toBe('1')
    expect(parsed.searchParams.get('controls')).toBe('1')
    expect(parsed.searchParams.get('origin')).toBe('http://127.0.0.1:5555')
  })

  it('refuses to build a URL from an invalid videoId', () => {
    expect(() => buildEmbedUrl('not-a-real-id-at-all', 'http://127.0.0.1')).toThrow()
    expect(() => buildEmbedUrl('../evilpath', 'http://127.0.0.1')).toThrow()
  })
})

describe('buildPlayerCommand', () => {
  it('produces the raw postMessage command JSON the embed API expects', () => {
    expect(JSON.parse(buildPlayerCommand('playVideo'))).toEqual({
      event: 'command',
      func: 'playVideo',
      args: []
    })
    expect(JSON.parse(buildPlayerCommand('pauseVideo'))).toEqual({
      event: 'command',
      func: 'pauseVideo',
      args: []
    })
    expect(JSON.parse(buildPlayerCommand('setVolume', [40]))).toEqual({
      event: 'command',
      func: 'setVolume',
      args: [40]
    })
  })
})

describe('command timing (Pro Guide regression)', () => {
  it('pins the mandatory 700ms post-load settle delay — do not remove it', () => {
    // The embedded player silently drops commands sent right after the
    // iframe load event. The guide is explicit: keep the 700ms delay.
    expect(YOUTUBE_COMMAND_DELAY_MS).toBe(700)
  })

  it('pins the only allowed postMessage target origin', () => {
    expect(YOUTUBE_EMBED_ORIGIN).toBe('https://www.youtube-nocookie.com')
  })
})
