// News-result quality layer: for news-type queries, tell apart actual
// articles from category/section/landing pages, and rank article-like
// results first. Broad queries like "latest AI news" make search engines
// return outlet section pages ("Reuters — Artificial intelligence",
// "TechCrunch AI category", Google News topics) — technically results, but
// useless for "what happened". The filter is conservative: it drops only
// clear category/landing pages (URL pattern + title/path evidence together),
// never articles, and the coordinator treats a category-only outcome as
// "unusable" so the real fallbacks (Brave, TechCrunch RSS) get their turn.

import type { SearchResult } from './types'

/** News-type query: the quality filter and recency bias apply only here. */
export function isNewsQuery(query: string): boolean {
  return /\b(news|latest|today|headlines?|happened|happening|announcements?|updates?|breaking)\b/i.test(
    query
  )
}

// URL path segments that mark listing/section pages rather than articles.
const CATEGORY_PATH_RE = /\/(category|categories|tag|tags|topics?|sections?|search|hub)(\/|$)/i

// Titles that are section labels, not headlines: "Artificial intelligence",
// "AI News", "Technology — Latest", "Artificial intelligence – Latest".
const SECTION_TITLE_RE =
  /^(artificial[\s-]?intelligence|a\.?i\.?|ai news|tech(nology)?( news)?|latest news|news|top stories)([\s–—|:-]+(news|latest|section|topics?|coverage|updates?|headlines?|stories))*$/i

function parsedUrl(result: SearchResult): URL | null {
  try {
    return new URL(result.url)
  } catch {
    return null
  }
}

/**
 * Conservative category/landing-page detector. A result is only rejected on
 * combined evidence (listing-style URL, aggregator domain, or a section-label
 * title on a shallow path) — a dated or deeply-slugged article URL always
 * survives, even when its path contains a generic word.
 */
export function looksLikeCategoryPage(result: SearchResult): boolean {
  const url = parsedUrl(result)
  if (!url) return false
  const path = url.pathname
  const segments = path.split('/').filter(Boolean)
  const dated = /\/20\d{2}\//.test(path)

  // /category/, /tag/, /topics/ … — unless the path also carries an article
  // date (some sites nest articles under sections).
  if (CATEGORY_PATH_RE.test(path) && !dated) return true

  // Bare outlet homepage offered as a "news result".
  if (segments.length === 0) return true

  // Google News links in engine results are topic/aggregator pages, not
  // articles — except direct /articles/ links.
  if (/(^|\.)news\.google\./.test(url.hostname) && !/\/articles\//.test(path)) return true

  // Section-label title on a shallow, undated path ("Artificial intelligence"
  // at reuters.com/technology/artificial-intelligence/).
  if (SECTION_TITLE_RE.test(result.title.trim()) && segments.length <= 2 && !dated) return true

  return false
}

/**
 * Article-likeness score for ranking (higher = more article-like):
 * dated URL, headline-style slug, meaningful snippet, publication date,
 * non-shallow path.
 */
export function scoreArticleLikeness(result: SearchResult): number {
  const url = parsedUrl(result)
  if (!url) return -5
  const path = url.pathname
  const segments = path.split('/').filter(Boolean)
  const slug = segments[segments.length - 1] ?? ''

  let score = 0
  if (/\/20\d{2}\//.test(path)) score += 2
  if ((slug.match(/-/g)?.length ?? 0) >= 3) score += 2
  if (result.snippet.length >= 80) score += 1
  if (result.publishedAt) score += 1
  if (segments.length >= 2) score += 1
  return score
}

/**
 * Filter out clear category/landing pages and rank the survivors most
 * article-like first (stable, so equal scores keep engine order). Logs a
 * safe KEEP/DROP line per result for diagnosis. May return empty — the
 * coordinator then continues to the next layer instead of serving category
 * pages as news.
 */
export function refineNewsResults(results: SearchResult[]): SearchResult[] {
  const kept: SearchResult[] = []
  for (const result of results) {
    const domain = parsedUrl(result)?.hostname ?? 'invalid-url'
    if (looksLikeCategoryPage(result)) {
      console.log(
        `[websearch:quality] DROP category/landing "${result.title.slice(0, 60)}" (${domain})`
      )
      continue
    }
    console.log(
      `[websearch:quality] KEEP article "${result.title.slice(0, 60)}" (${domain}) ` +
        `score=${scoreArticleLikeness(result)}`
    )
    kept.push(result)
  }
  return kept
    .map((result, index) => ({ result, index, score: scoreArticleLikeness(result) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.result)
}
