import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseDuckDuckGoHtml, searchDuckDuckGo, unwrapDuckDuckGoUrl } from '../duckduckgo'
import { CHROME_UA, cleanResults } from '../types'
import { WebSearchError } from '../types'

// A trimmed real-shape DuckDuckGo HTML results page: redirect-wrapped hrefs,
// nested <b> highlights, HTML entities, a duplicate, and an empty-title row.
const DDG_HTML = `
<div class="result results_links results_links_deep web-result">
  <h2 class="result__title">
    <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fai-news&amp;rut=abc123">Big <b>AI</b> News &amp; Updates</a>
  </h2>
  <a class="result__snippet" href="//duckduckgo.com/l/?uddg=x">The latest <b>AI</b> developments &quot;today&quot;.</a>
</div>
<div class="result">
  <a rel="nofollow" class="result__a" href="https://direct.example.org/story">Direct Result</a>
  <a class="result__snippet" href="#">Second snippet here.</a>
</div>
<div class="result">
  <a rel="nofollow" class="result__a" href="https://direct.example.org/story">Direct Result Duplicate</a>
  <a class="result__snippet" href="#">Duplicate URL should be dropped.</a>
</div>
<div class="result">
  <a rel="nofollow" class="result__a" href="https://empty-title.example.com"> </a>
</div>
<div class="result">
  <a rel="nofollow" class="result__a" href="javascript:alert(1)">Bad Scheme</a>
</div>`

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

describe('unwrapDuckDuckGoUrl', () => {
  it('unwraps the uddg redirect to the real destination', () => {
    expect(
      unwrapDuckDuckGoUrl('//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa&rut=x')
    ).toBe('https://example.com/a')
  })

  it('passes through direct URLs untouched', () => {
    expect(unwrapDuckDuckGoUrl('https://direct.example.org/story')).toBe(
      'https://direct.example.org/story'
    )
  })
})

describe('parseDuckDuckGoHtml', () => {
  it('extracts result__a titles/URLs and result__snippet text, in order', () => {
    const results = parseDuckDuckGoHtml(DDG_HTML)
    expect(results[0].title).toBe('Big AI News & Updates')
    expect(results[0].url).toBe('https://example.com/ai-news')
    expect(results[0].snippet).toBe('The latest AI developments "today".')
    expect(results[1].title).toBe('Direct Result')
    expect(results[1].url).toBe('https://direct.example.org/story')
    expect(results[1].snippet).toBe('Second snippet here.')
  })

  it('returns empty on pages without results or with changed markup', () => {
    expect(parseDuckDuckGoHtml('<html><body>No results.</body></html>')).toEqual([])
    expect(parseDuckDuckGoHtml('')).toEqual([])
    expect(parseDuckDuckGoHtml('<div class="different__markup">x</div>')).toEqual([])
  })
})

describe('cleanResults', () => {
  it('drops empty titles, bad schemes, and duplicate URLs; caps the count', () => {
    const cleaned = cleanResults(parseDuckDuckGoHtml(DDG_HTML))
    expect(cleaned).toHaveLength(2)
    expect(cleaned.map((r) => r.url)).toEqual([
      'https://example.com/ai-news',
      'https://direct.example.org/story'
    ])
    const many = cleanResults(
      Array.from({ length: 20 }, (_, i) => ({
        title: `T${i}`,
        url: `https://example.com/${i}`,
        snippet: '',
        source: 'DuckDuckGo' as const
      }))
    )
    expect(many).toHaveLength(6)
  })
})

describe('searchDuckDuckGo', () => {
  it('fetches the html endpoint with encoded query, exact Chrome 124 UA, and no-cache', async () => {
    const fetchMock = mockFetch(200, DDG_HTML)
    const results = await searchDuckDuckGo('latest AI news & more')

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://html.duckduckgo.com/html/?q=latest%20AI%20news%20%26%20more')
    expect(init.headers['User-Agent']).toBe(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    )
    expect(init.headers['User-Agent']).toBe(CHROME_UA)
    expect(init.headers['Cache-Control']).toBe('no-cache')
    expect(results).toHaveLength(2)
  })

  it('honors the DDG_BASE_URL override', async () => {
    vi.stubEnv('DDG_BASE_URL', 'http://127.0.0.1:9999')
    const fetchMock = mockFetch(200, DDG_HTML)
    await searchDuckDuckGo('x')
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/^http:\/\/127\.0\.0\.1:9999\/html\/\?q=x$/)
  })

  it('returns an empty array (not an error) for a parseable page with no results', async () => {
    mockFetch(200, '<html>nothing here</html>')
    await expect(searchDuckDuckGo('x')).resolves.toEqual([])
  })

  it('throws WebSearchError on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
    await expect(searchDuckDuckGo('x')).rejects.toThrow('DuckDuckGo could not be reached.')
  })

  it('throws WebSearchError on timeout', async () => {
    const timeout = new Error('t')
    timeout.name = 'TimeoutError'
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeout))
    await expect(searchDuckDuckGo('x')).rejects.toThrow('DuckDuckGo timed out.')
  })

  it('throws WebSearchError on HTTP error status', async () => {
    mockFetch(503, 'busy')
    await expect(searchDuckDuckGo('x')).rejects.toThrow(WebSearchError)
    mockFetch(429, 'rate limited')
    await expect(searchDuckDuckGo('x')).rejects.toThrow('status 429')
  })
})
