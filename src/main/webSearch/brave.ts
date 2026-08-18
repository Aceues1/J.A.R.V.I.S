// Layer 2 — Brave Search API fallback. Strictly optional: it only activates
// when the user has configured BRAVE_SEARCH_API_KEY. Without a key the layer
// is skipped silently — the baseline must work keyless.

import { CHROME_UA, cleanResults, stripTags, WebSearchError, type SearchResult } from './types'

const DEFAULT_BASE_URL = 'https://api.search.brave.com'
const REQUEST_TIMEOUT_MS = 10_000

export function braveConfigured(): boolean {
  return Boolean(process.env.BRAVE_SEARCH_API_KEY)
}

export async function searchBrave(query: string): Promise<SearchResult[]> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY
  if (!apiKey) {
    throw new WebSearchError('Brave Search is not configured.')
  }
  const baseUrl = process.env.BRAVE_BASE_URL || DEFAULT_BASE_URL
  const url = `${baseUrl}/res/v1/web/search?q=${encodeURIComponent(query)}&count=8`

  let response: Response
  try {
    response = await fetch(url, {
      headers: {
        'User-Agent': CHROME_UA,
        'Cache-Control': 'no-cache',
        Accept: 'application/json',
        'X-Subscription-Token': apiKey
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      console.error('[websearch:brave] timed out')
      throw new WebSearchError('Brave Search timed out.')
    }
    console.error('[websearch:brave] network error', error)
    throw new WebSearchError('Brave Search could not be reached.')
  }

  if (!response.ok) {
    console.error('[websearch:brave] HTTP', response.status)
    throw new WebSearchError(`Brave Search returned an error (status ${response.status}).`)
  }

  let data: unknown
  try {
    data = await response.json()
  } catch (error) {
    console.error('[websearch:brave] invalid JSON', error)
    throw new WebSearchError('Brave Search returned an unreadable response.')
  }

  const items = (data as { web?: { results?: unknown } })?.web?.results
  if (!Array.isArray(items)) {
    console.error('[websearch:brave] unexpected response shape')
    throw new WebSearchError('Brave Search returned an unexpected response.')
  }

  const results: SearchResult[] = []
  for (const item of items) {
    const { title, url: itemUrl, description } = (item ?? {}) as Record<string, unknown>
    results.push({
      title: typeof title === 'string' ? stripTags(title) : '',
      url: typeof itemUrl === 'string' ? itemUrl : '',
      snippet: typeof description === 'string' ? stripTags(description) : '',
      source: 'Brave Search'
    })
  }
  return cleanResults(results)
}
