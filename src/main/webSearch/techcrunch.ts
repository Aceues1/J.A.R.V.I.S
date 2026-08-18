// Layer 3 — TechCrunch RSS, the guide's last-resort source for AI-news
// queries specifically. It is NOT a general web-search replacement: the
// coordinator only reaches for it when the query is clearly AI-news related
// and the general layers have failed. Results are labelled with their source
// so JARVIS never presents one outlet as "the web".

import { CHROME_UA, cleanResults, decodeEntities, stripTags, WebSearchError } from './types'
import type { SearchResult } from './types'

const DEFAULT_FEED_URL = 'https://techcrunch.com/category/artificial-intelligence/feed/'
const REQUEST_TIMEOUT_MS = 10_000

/**
 * Conservative AI-news classifier: "latest AI news", "what happened in AI
 * today", "OpenAI news", "AI news today" — not every message that mentions
 * AI. General questions stay with the general layers.
 */
export function isAiNewsQuery(query: string): boolean {
  const q = query.toLowerCase()
  const newsish =
    /\b(news|latest|today|happened|happening|announcements?|headlines|updates?)\b/.test(q)
  if (!newsish) return false
  const aiish =
    /(^|\W)(ai|a\.i\.)(\W|$)/.test(q) ||
    /\b(openai|anthropic|deepmind|artificial intelligence|machine learning|llm)\b/.test(q)
  return aiish
}

function pickTag(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'))
  if (!match) return ''
  const inner = match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  return stripTags(decodeEntities(inner))
}

/** Parse an RSS 2.0 feed into search results; malformed items are skipped. */
export function parseRss(xml: string): SearchResult[] {
  const results: SearchResult[] = []
  for (const item of xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? []) {
    const title = pickTag(item, 'title')
    const link = pickTag(item, 'link')
    const pubDate = pickTag(item, 'pubDate')
    const description = pickTag(item, 'description')
    results.push({
      title,
      url: link,
      snippet: description.slice(0, 300),
      source: 'TechCrunch RSS',
      publishedAt: pubDate || undefined
    })
  }
  return results
}

export async function fetchTechCrunchAiNews(): Promise<SearchResult[]> {
  const feedUrl = process.env.TECHCRUNCH_RSS_URL || DEFAULT_FEED_URL

  let response: Response
  try {
    response = await fetch(feedUrl, {
      headers: { 'User-Agent': CHROME_UA, 'Cache-Control': 'no-cache' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      console.error('[websearch:techcrunch] timed out')
      throw new WebSearchError('TechCrunch timed out.')
    }
    console.error('[websearch:techcrunch] network error', error)
    throw new WebSearchError('TechCrunch could not be reached.')
  }

  if (!response.ok) {
    console.error('[websearch:techcrunch] HTTP', response.status)
    throw new WebSearchError(`TechCrunch returned an error (status ${response.status}).`)
  }

  let xml: string
  try {
    xml = await response.text()
  } catch (error) {
    console.error('[websearch:techcrunch] unreadable response', error)
    throw new WebSearchError('TechCrunch returned an unreadable response.')
  }

  const results = cleanResults(parseRss(xml))
  if (results.length === 0) {
    throw new WebSearchError('TechCrunch feed had no readable items.')
  }
  return results
}
