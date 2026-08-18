// Layer 1 — DuckDuckGo HTML, the guide's keyless baseline. We fetch the
// plain-HTML results page (NOT the Instant Answer API, which the guide
// explicitly rules out as useless for real queries) and parse the
// result__a / result__snippet markup. The parsing is defensive: DuckDuckGo
// can and does change this HTML, and a parse miss must surface as an empty
// result set, never a crash.

import { CHROME_UA, cleanResults, stripTags, WebSearchError, type SearchResult } from './types'

const DEFAULT_BASE_URL = 'https://html.duckduckgo.com'
const REQUEST_TIMEOUT_MS = 12_000

/**
 * DuckDuckGo wraps result hrefs in a redirect: //duckduckgo.com/l/?uddg=
 * {encoded real URL}&rut=… — unwrap to the real destination.
 */
export function unwrapDuckDuckGoUrl(href: string): string {
  const normalized = href.startsWith('//') ? `https:${href}` : href
  try {
    const parsed = new URL(normalized)
    const uddg = parsed.searchParams.get('uddg')
    if (uddg && (parsed.hostname.endsWith('duckduckgo.com') || parsed.pathname.startsWith('/l/'))) {
      return uddg
    }
  } catch {
    // fall through — return as-is and let cleanResults judge it
  }
  return normalized
}

/** Parse the DuckDuckGo HTML results page into raw results (title/url/snippet). */
export function parseDuckDuckGoHtml(html: string): SearchResult[] {
  const results: SearchResult[] = []
  // Anchor on the guide's result__a link; the matching result__snippet (when
  // present) sits between this result link and the next one.
  const linkRe = /class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g
  const matches = [...html.matchAll(linkRe)]
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]
    const sliceEnd = i + 1 < matches.length ? matches[i + 1].index : html.length
    const between = html.slice((match.index ?? 0) + match[0].length, sliceEnd)
    const snippetMatch = between.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div)>/)
    results.push({
      title: stripTags(match[2]),
      url: unwrapDuckDuckGoUrl(decodeEntitiesInHref(match[1])),
      snippet: snippetMatch ? stripTags(snippetMatch[1]) : '',
      source: 'DuckDuckGo'
    })
  }
  return results
}

// hrefs are attribute values: entity-decode but never strip (URLs aren't markup)
function decodeEntitiesInHref(href: string): string {
  return href.replace(/&amp;/g, '&').trim()
}

/**
 * Search DuckDuckGo's HTML endpoint. Returns cleaned results (possibly
 * empty when the page has no parseable results); throws WebSearchError on
 * network/timeout/HTTP failures so the coordinator can fall back.
 */
export async function searchDuckDuckGo(query: string): Promise<SearchResult[]> {
  const baseUrl = process.env.DDG_BASE_URL || DEFAULT_BASE_URL
  const url = `${baseUrl}/html/?q=${encodeURIComponent(query)}`

  let response: Response
  try {
    response = await fetch(url, {
      headers: {
        'User-Agent': CHROME_UA,
        'Cache-Control': 'no-cache'
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      console.error('[websearch:ddg] timed out')
      throw new WebSearchError('DuckDuckGo timed out.')
    }
    console.error('[websearch:ddg] network error', error)
    throw new WebSearchError('DuckDuckGo could not be reached.')
  }

  if (!response.ok) {
    console.error('[websearch:ddg] HTTP', response.status)
    throw new WebSearchError(`DuckDuckGo returned an error (status ${response.status}).`)
  }

  let html: string
  try {
    html = await response.text()
  } catch (error) {
    console.error('[websearch:ddg] unreadable response', error)
    throw new WebSearchError('DuckDuckGo returned an unreadable response.')
  }

  return cleanResults(parseDuckDuckGoHtml(html))
}
