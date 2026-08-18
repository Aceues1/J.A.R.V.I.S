import { afterEach, describe, expect, it, vi } from 'vitest'
import { extractFirstVideo, searchYouTube, VIDEO_ID_RE, YouTubeError } from '../youtube'

// A trimmed-down results page in the real shape: ytInitialData JSON with the
// first organic videoRenderer carrying the id and title.
const RESULTS_HTML =
  '<html><script>var ytInitialData = {"contents":[{"videoRenderer":{"videoId":"dQw4w9WgXcQ",' +
  '"thumbnail":{"thumbnails":[]},"title":{"runs":[{"text":"Test Video Title"}]}}}]};</script></html>'

function mockHtmlFetch(status: number, body: string): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('extractFirstVideo', () => {
  it('extracts the first videoId, title, and thumbnail from a results page', () => {
    const video = extractFirstVideo(RESULTS_HTML)
    expect(video).toEqual({
      videoId: 'dQw4w9WgXcQ',
      title: 'Test Video Title',
      thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'
    })
  })

  it('returns the FIRST renderer when several are present', () => {
    const html =
      '{"videoRenderer":{"videoId":"first_vid01","title":{"runs":[{"text":"First"}]}}},' +
      '{"videoRenderer":{"videoId":"second_vid2","title":{"runs":[{"text":"Second"}]}}}'
    expect(extractFirstVideo(html)?.videoId).toBe('first_vid01')
  })

  it('unescapes JSON escapes in titles', () => {
    const html =
      '{"videoRenderer":{"videoId":"abcdefghijk","title":{"runs":[{"text":"Quote \\" and \\\\ done"}]}}}'
    expect(extractFirstVideo(html)?.title).toBe('Quote " and \\ done')
  })

  it('still returns the video when no title is extractable', () => {
    const html = '{"videoRenderer":{"videoId":"abcdefghijk","other":true}}'
    const video = extractFirstVideo(html)
    expect(video?.videoId).toBe('abcdefghijk')
    expect(video?.title).toBeUndefined()
  })

  it('returns null on pages without a videoRenderer (no results / malformed)', () => {
    expect(extractFirstVideo('<html>no videos here</html>')).toBeNull()
    expect(extractFirstVideo('')).toBeNull()
    expect(extractFirstVideo('{"videoRenderer":{"videoId":"tooshort"}}')).toBeNull()
  })

  it('only accepts strict 11-character videoIds', () => {
    expect(VIDEO_ID_RE.test('dQw4w9WgXcQ')).toBe(true)
    expect(VIDEO_ID_RE.test('short')).toBe(false)
    expect(VIDEO_ID_RE.test('waytoolongvideoid')).toBe(false)
    expect(VIDEO_ID_RE.test('bad!chars<>')).toBe(false)
  })
})

describe('searchYouTube', () => {
  it('URL-encodes the query and applies the video filter parameter', async () => {
    const fetchMock = mockHtmlFetch(200, RESULTS_HTML)
    const video = await searchYouTube('iron man & "friends"')
    expect(video.videoId).toBe('dQw4w9WgXcQ')

    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('/results?search_query=iron%20man%20%26%20%22friends%22')
    expect(url).toContain('sp=EgIQAQ%3D%3D')
  })

  it('honors the YOUTUBE_BASE_URL override', async () => {
    vi.stubEnv('YOUTUBE_BASE_URL', 'http://127.0.0.1:9999')
    const fetchMock = mockHtmlFetch(200, RESULTS_HTML)
    await searchYouTube('test')
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/^http:\/\/127\.0\.0\.1:9999\/results\?/)
  })

  it('rejects an empty or whitespace-only query without fetching', async () => {
    const fetchMock = mockHtmlFetch(200, RESULTS_HTML)
    await expect(searchYouTube('   ')).rejects.toThrow(YouTubeError)
    await expect(searchYouTube('')).rejects.toThrow('No search topic was given.')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('maps network failure to a clean YouTubeError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
    await expect(searchYouTube('x')).rejects.toThrow('YouTube could not be reached.')
  })

  it('maps a timeout to a clean YouTubeError', async () => {
    const timeout = new Error('timed out')
    timeout.name = 'TimeoutError'
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeout))
    await expect(searchYouTube('x')).rejects.toThrow('The YouTube search timed out.')
  })

  it('maps an HTTP error status to a clean YouTubeError', async () => {
    mockHtmlFetch(503, 'unavailable')
    await expect(searchYouTube('x')).rejects.toThrow('YouTube returned an error (status 503).')
  })

  it('maps an unreadable body to a clean YouTubeError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: () => Promise.reject(new Error('stream broke'))
      })
    )
    await expect(searchYouTube('x')).rejects.toThrow('YouTube returned an unreadable response.')
  })

  it('reports no-result pages honestly', async () => {
    mockHtmlFetch(200, '<html>nothing embedded</html>')
    await expect(searchYouTube('x')).rejects.toThrow('No playable result was found.')
  })
})
