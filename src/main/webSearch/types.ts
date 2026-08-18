// Shared types for the PRO 3 layered web-search service. Everything here
// runs in the MAIN process only — the renderer never fetches the web.

export class WebSearchError extends Error {}

export interface SearchResult {
  title: string
  url: string
  snippet: string
  /** Which layer produced this result — used for honest attribution. */
  source: 'DuckDuckGo' | 'Brave Search' | 'TechCrunch RSS'
  /** RSS items carry a publication date when available. */
  publishedAt?: string
}

// The guide's exact Chrome 124 User-Agent — every web fetch must send it.
export const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/124.0.0.0 Safari/537.36'

/** Decode the handful of HTML entities that appear in titles and snippets. */
export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

/** Strip markup tags and collapse whitespace from an HTML fragment. */
export function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim()
}

/**
 * Result hygiene: drop entries with empty titles or unusable URLs, drop
 * duplicate URLs, cap the count, and keep the original (meaningful) order.
 */
export function cleanResults(results: SearchResult[], limit = 6): SearchResult[] {
  const seen = new Set<string>()
  const cleaned: SearchResult[] = []
  for (const result of results) {
    const title = result.title.trim()
    const url = result.url.trim()
    if (!title || !url) continue
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      continue
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') continue
    const key = parsed.href
    if (seen.has(key)) continue
    seen.add(key)
    cleaned.push({ ...result, title, url: parsed.href, snippet: result.snippet.trim() })
    if (cleaned.length >= limit) break
  }
  return cleaned
}
