import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  formatFailureBlock,
  formatResultsBlock,
  getLiveSearchContext,
  resetSearchCache,
  searchWeb,
  SEARCH_CACHE_TTL_MS
} from '../index'
import type { ChatTurn } from '../../chat-validation'

const DDG_HTML =
  '<a class="result__a" href="https://one.example.com/a">Result One</a>' +
  '<a class="result__snippet" href="#">Snippet one.</a>' +
  '<a class="result__a" href="https://two.example.com/b">Result Two</a>' +
  '<a class="result__snippet" href="#">Snippet two.</a>'

const RSS_XML =
  '<rss><channel><item><title>AI story</title>' +
  '<link>https://techcrunch.com/ai-story/</link>' +
  '<pubDate>Mon, 18 Aug 2026 09:00:00 +0000</pubDate>' +
  '<description>An AI thing happened.</description></item></channel></rss>'

interface Route {
  match: (url: string) => boolean
  status?: number
  body: unknown
}

/** Stub fetch with URL-based routing; returns per-route hit counters. */
function stubRoutes(routes: Record<string, Route>): Record<string, number> {
  const hits: Record<string, number> = Object.fromEntries(Object.keys(routes).map((k) => [k, 0]))
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input)
      for (const [name, route] of Object.entries(routes)) {
        if (route.match(url)) {
          hits[name] += 1
          const status = route.status ?? 200
          const body = route.body
          return {
            ok: status >= 200 && status < 300,
            status,
            text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
            json: () =>
              typeof body === 'string'
                ? Promise.reject(new Error('not json'))
                : Promise.resolve(body)
          }
        }
      }
      throw new TypeError(`no route for ${url}`)
    })
  )
  return hits
}

function gateRoute(reply: string): Route {
  return {
    match: (url) => url.includes('/chat/completions'),
    body: { choices: [{ message: { content: reply } }] }
  }
}

const user = (content: string): ChatTurn => ({ role: 'user', content })

beforeEach(() => {
  vi.stubEnv('GROQ_API_KEY', 'test-key')
  vi.stubEnv('BRAVE_SEARCH_API_KEY', '')
  resetSearchCache()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('searchWeb — layered fallback', () => {
  it('uses DuckDuckGo when it returns results', async () => {
    const hits = stubRoutes({
      ddg: { match: (u) => u.includes('duckduckgo.com/html'), body: DDG_HTML }
    })
    const { source, results } = await searchWeb('anything current')
    expect(source).toBe('DuckDuckGo')
    expect(results).toHaveLength(2)
    expect(hits.ddg).toBe(1)
  })

  it('falls back to Brave when DuckDuckGo is empty AND a key is configured', async () => {
    vi.stubEnv('BRAVE_SEARCH_API_KEY', 'brave-key')
    const hits = stubRoutes({
      ddg: { match: (u) => u.includes('duckduckgo.com/html'), body: '<html>no results</html>' },
      brave: {
        match: (u) => u.includes('api.search.brave.com'),
        body: {
          web: { results: [{ title: 'Brave hit', url: 'https://b.example.com', description: 'd' }] }
        }
      }
    })
    const { source } = await searchWeb('anything current')
    expect(source).toBe('Brave Search')
    expect(hits.ddg).toBe(1)
    expect(hits.brave).toBe(1)
  })

  it('skips Brave without a key and reaches TechCrunch for AI-news queries', async () => {
    const hits = stubRoutes({
      ddg: { match: (u) => u.includes('duckduckgo.com/html'), status: 500, body: 'down' },
      brave: { match: (u) => u.includes('api.search.brave.com'), body: {} },
      tc: { match: (u) => u.includes('techcrunch.com'), body: RSS_XML }
    })
    const { source, results } = await searchWeb('latest AI news')
    expect(source).toBe('TechCrunch RSS')
    expect(results[0].title).toBe('AI story')
    expect(hits.brave).toBe(0)
    expect(hits.tc).toBe(1)
  })

  it('does NOT use TechCrunch for non-AI-news queries', async () => {
    const hits = stubRoutes({
      ddg: { match: (u) => u.includes('duckduckgo.com/html'), status: 500, body: 'down' },
      tc: { match: (u) => u.includes('techcrunch.com'), body: RSS_XML }
    })
    await expect(searchWeb('best pizza in rome')).rejects.toThrow('Every web search source failed')
    expect(hits.tc).toBe(0)
  })

  it('throws when every applicable layer fails', async () => {
    vi.stubEnv('BRAVE_SEARCH_API_KEY', 'brave-key')
    stubRoutes({
      ddg: { match: (u) => u.includes('duckduckgo.com/html'), status: 500, body: 'down' },
      brave: { match: (u) => u.includes('api.search.brave.com'), status: 500, body: {} },
      tc: { match: (u) => u.includes('techcrunch.com'), status: 500, body: 'down' }
    })
    await expect(searchWeb('latest AI news')).rejects.toThrow('Every web search source failed')
  })
})

describe('formatting', () => {
  it('formats a compact numbered block with source attribution', () => {
    const block = formatResultsBlock('ai news', 'DuckDuckGo', [
      { title: 'T1', url: 'https://a.example.com', snippet: 'S1', source: 'DuckDuckGo' },
      { title: 'T2', url: 'https://b.example.com', snippet: '', source: 'DuckDuckGo' }
    ])
    expect(block).toContain('# Live web search results')
    expect(block).toContain('Query: ai news')
    expect(block).toContain('Source: DuckDuckGo')
    // Each result is labelled with its outlet so answers can cite it.
    expect(block).toContain('1. T1 (a.example.com)\n   https://a.example.com\n   S1')
    expect(block).toContain('2. T2 (b.example.com)')
    expect(block).toContain('untrusted')
    expect(block).toContain('do not claim to have read full articles')
  })

  it('demands concrete, specific answers — vague summaries are a failed answer', () => {
    const block = formatResultsBlock('ai news', 'DuckDuckGo', [
      { title: 'T', url: 'https://a.example.com', snippet: 'S', source: 'DuckDuckGo' }
    ])
    expect(block).toContain('lead with the most specific, recent headlines and facts')
    expect(block).toContain('names, products, numbers, dates')
    expect(block).toContain('is a failed answer')
    expect(block).toContain('every claim must be traceable to a result above')
    expect(block).toContain('According to <outlet>')
  })

  it('includes the RSS publication date alongside the outlet', () => {
    const block = formatResultsBlock('ai news', 'TechCrunch RSS', [
      {
        title: 'T',
        url: 'https://techcrunch.com/x/',
        snippet: 'S',
        source: 'TechCrunch RSS',
        publishedAt: 'Mon, 18 Aug 2026 09:00:00 +0000'
      }
    ])
    expect(block).toContain('1. T (techcrunch.com, Mon, 18 Aug 2026 09:00:00 +0000)')
  })

  it('labels TechCrunch as a single-outlet source, not the whole web', () => {
    const block = formatResultsBlock('ai news', 'TechCrunch RSS', [
      { title: 'T', url: 'https://tc.example.com', snippet: 'S', source: 'TechCrunch RSS' }
    ])
    expect(block).toContain('TechCrunch AI feed only, not the whole web')
  })

  it('produces an honest failure block', () => {
    const block = formatFailureBlock('ai news')
    expect(block).toContain("I wasn't able to reach the web just now, sir.")
    expect(block).toContain('Do not invent current information')
  })
})

describe('getLiveSearchContext — per-turn coordinator', () => {
  it('returns null for trivial messages without any network call', async () => {
    const hits = stubRoutes({ any: { match: () => true, body: '' } })
    await expect(getLiveSearchContext([user('Hey.')])).resolves.toBeNull()
    expect(hits.any).toBe(0)
  })

  it('returns null when the gate says no live data is needed', async () => {
    const hits = stubRoutes({
      gate: gateRoute('{"search":false}'),
      ddg: { match: (u) => u.includes('duckduckgo.com'), body: DDG_HTML }
    })
    await expect(getLiveSearchContext([user('What is the capital of France?')])).resolves.toBeNull()
    expect(hits.gate).toBe(1)
    expect(hits.ddg).toBe(0)
  })

  it('runs the layered search and builds the context block when the gate says yes', async () => {
    const hits = stubRoutes({
      gate: gateRoute('{"search":true,"query":"latest AI news"}'),
      ddg: { match: (u) => u.includes('duckduckgo.com/html'), body: DDG_HTML }
    })
    const context = await getLiveSearchContext([user("What's the latest AI news?")])
    expect(context?.ok).toBe(true)
    expect(context?.source).toBe('DuckDuckGo')
    expect(context?.query).toBe('latest AI news')
    expect(context?.block).toContain('Result One')
    expect(hits.ddg).toBe(1)
  })

  it('routes market queries to Yahoo Finance, never to general search', async () => {
    const hits = stubRoutes({
      gate: gateRoute('{"search":true,"query":"bitcoin price right now"}'),
      yahoo: {
        match: (u) => u.includes('/v8/finance/chart/BTC-USD'),
        body: { chart: { result: [{ meta: { regularMarketPrice: 97432.1, currency: 'USD' } }] } }
      },
      ddg: { match: (u) => u.includes('duckduckgo.com'), body: DDG_HTML }
    })
    const context = await getLiveSearchContext([user("What's Bitcoin at right now?")])
    expect(context?.source).toBe('Yahoo Finance')
    expect(context?.block).toContain('97,432.1')
    expect(hits.yahoo).toBe(1)
    expect(hits.ddg).toBe(0)
  })

  it('routes other-location weather to wttr.in and existing locations to nothing', async () => {
    const hits = stubRoutes({
      gate: gateRoute('{"search":true,"query":"weather in London"}'),
      wttr: {
        match: (u) => u.includes('wttr.in'),
        body: {
          current_condition: [
            { temp_C: '14', FeelsLikeC: '12', weatherDesc: [{ value: 'Cloudy' }] }
          ]
        }
      }
    })
    const context = await getLiveSearchContext([user('What is the weather in London?')])
    expect(context?.source).toBe('wttr.in')
    expect(context?.block).toContain('14°C')
    expect(hits.wttr).toBe(1)

    // Existing-feed locations never reach the web path, even if the gate says search.
    stubRoutes({ gate: gateRoute('{"search":true,"query":"weather in Trondheim"}') })
    await expect(
      getLiveSearchContext([user("What's the weather in Trondheim?")])
    ).resolves.toBeNull()
  })

  it('returns an honest failure block when every source fails — and never throws', async () => {
    stubRoutes({
      gate: gateRoute('{"search":true,"query":"latest football scores"}')
      // no ddg/brave/tc routes: all fetches fail with TypeError
    })
    const context = await getLiveSearchContext([user('who won yesterday?')])
    expect(context?.ok).toBe(false)
    expect(context?.block).toContain("I wasn't able to reach the web just now, sir.")
  })

  it('caches successful results briefly and never caches failures', async () => {
    const hits = stubRoutes({
      gate: gateRoute('{"search":true,"query":"latest AI news"}'),
      ddg: { match: (u) => u.includes('duckduckgo.com/html'), body: DDG_HTML }
    })
    await getLiveSearchContext([user('latest AI news?')])
    await getLiveSearchContext([user('latest AI news?')])
    expect(hits.ddg).toBe(1) // second call served from cache
    expect(SEARCH_CACHE_TTL_MS).toBeLessThanOrEqual(60_000) // short-lived by contract

    resetSearchCache()
    await getLiveSearchContext([user('latest AI news?')])
    expect(hits.ddg).toBe(2)
  })
})
