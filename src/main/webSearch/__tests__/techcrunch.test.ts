import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchTechCrunchAiNews, isAiNewsQuery, parseRss } from '../techcrunch'

const RSS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>TechCrunch AI</title>
  <item>
    <title><![CDATA[OpenAI ships a new model & more]]></title>
    <link>https://techcrunch.com/2026/08/18/openai-ships/</link>
    <pubDate>Mon, 18 Aug 2026 09:00:00 +0000</pubDate>
    <description><![CDATA[<p>The company announced a <b>new</b> flagship model.</p>]]></description>
  </item>
  <item>
    <title>Anthropic raises again</title>
    <link>https://techcrunch.com/2026/08/17/anthropic-raises/</link>
    <pubDate>Sun, 17 Aug 2026 12:00:00 +0000</pubDate>
    <description>Another funding round.</description>
  </item>
  <item>
    <title>Broken item with no link</title>
  </item>
</channel></rss>`

function mockFetch(status: number, body: string): ReturnType<typeof vi.fn> {
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

describe('isAiNewsQuery', () => {
  it.each([
    'latest AI news',
    'what happened in AI today',
    'OpenAI news',
    'AI news today',
    'any anthropic announcements?',
    'what is the latest in artificial intelligence'
  ])('classifies %j as AI news', (query) => {
    expect(isAiNewsQuery(query)).toBe(true)
  })

  it.each([
    'best pizza in trondheim',
    'what is AI', // stable knowledge, not news
    'iron man movie news', // news, but not AI
    'how do I train a model',
    'football results today'
  ])('does NOT classify %j as AI news', (query) => {
    expect(isAiNewsQuery(query)).toBe(false)
  })
})

describe('parseRss', () => {
  it('parses items with CDATA titles, links, dates, and stripped descriptions', () => {
    const results = parseRss(RSS_XML)
    expect(results[0].title).toBe('OpenAI ships a new model & more')
    expect(results[0].url).toBe('https://techcrunch.com/2026/08/18/openai-ships/')
    expect(results[0].publishedAt).toBe('Mon, 18 Aug 2026 09:00:00 +0000')
    expect(results[0].snippet).toContain('announced a new flagship model')
    expect(results[0].source).toBe('TechCrunch RSS')
    expect(results[1].title).toBe('Anthropic raises again')
  })

  it('handles malformed RSS without crashing', () => {
    expect(parseRss('<rss><channel><item>broken')).toEqual([])
    expect(parseRss('not xml at all')).toEqual([])
    expect(parseRss('')).toEqual([])
  })
})

describe('fetchTechCrunchAiNews', () => {
  it('fetches the feed and drops items without usable links', async () => {
    const fetchMock = mockFetch(200, RSS_XML)
    const results = await fetchTechCrunchAiNews()
    expect(results).toHaveLength(2)
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      'techcrunch.com/category/artificial-intelligence/feed/'
    )
  })

  it('honors the TECHCRUNCH_RSS_URL override', async () => {
    vi.stubEnv('TECHCRUNCH_RSS_URL', 'http://127.0.0.1:9999/feed/')
    const fetchMock = mockFetch(200, RSS_XML)
    await fetchTechCrunchAiNews()
    expect(String(fetchMock.mock.calls[0][0])).toBe('http://127.0.0.1:9999/feed/')
  })

  it('treats a feed with no readable items as a failure', async () => {
    mockFetch(200, '<rss><channel></channel></rss>')
    await expect(fetchTechCrunchAiNews()).rejects.toThrow('no readable items')
  })

  it('maps network failure and HTTP errors to WebSearchError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('down')))
    await expect(fetchTechCrunchAiNews()).rejects.toThrow('TechCrunch could not be reached.')
    mockFetch(500, 'oops')
    await expect(fetchTechCrunchAiNews()).rejects.toThrow('status 500')
  })
})
