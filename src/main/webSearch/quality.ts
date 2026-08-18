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

// Article-date shapes in URLs: /2026/08/…, /2026-08-18/…, …-2026-08-18/
function hasUrlDate(path: string): boolean {
  return /\/20\d{2}[/-]/.test(path) || /20\d{2}-\d{2}-\d{2}/.test(path)
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
  const dated = hasUrlDate(path)

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
 * non-shallow path — plus a recency bonus for fresh publication dates and a
 * penalty (never a rejection) for roundup/digest-style titles.
 */
const RECENT_WINDOW_MS = 7 * 24 * 3600 * 1000
// Roundups/digests are ranked LOWER, never dropped outright — a roundup that
// carries concrete dated stories can still be the best available result.
const ROUNDUP_TITLE_RE = /\b(roundup|recap|digest|newsletter|weekly|daily)\b/i

export function scoreArticleLikeness(result: SearchResult): number {
  const url = parsedUrl(result)
  if (!url) return -5
  const path = url.pathname
  const segments = path.split('/').filter(Boolean)
  const slug = segments[segments.length - 1] ?? ''

  let score = 0
  if (hasUrlDate(path)) score += 2
  if ((slug.match(/-/g)?.length ?? 0) >= 3) score += 2
  if (result.snippet.length >= 80) score += 1
  if (result.publishedAt) {
    score += 1
    // "Latest" means latest: a parseable date within the past week is the
    // strongest article signal we have. Never fabricated — parse or nothing.
    const time = Date.parse(result.publishedAt)
    if (Number.isFinite(time) && Math.abs(Date.now() - time) < RECENT_WINDOW_MS) score += 2
  }
  if (segments.length >= 2) score += 1
  if (ROUNDUP_TITLE_RE.test(result.title)) score -= 2
  return score
}

// A result at or above this score is confidently an article (dated URL +
// headline slug, or a fresh publication date, etc.).
export const STRONG_ARTICLE_SCORE = 3
// When at least this many strong articles exist, weak hub/landing-ish
// results (score < WEAK_CUTOFF) are dropped instead of padding the block.
const STRONG_NEEDED_TO_PRUNE = 3
const WEAK_CUTOFF = 2

/**
 * Filter out clear category/landing pages, rank the survivors most
 * article-like first (stable, so equal scores keep source order), and —
 * only when enough confidently-article results exist — prune the weak
 * hub/roundup leftovers so they never pad the context block. May return
 * empty; the coordinator then tries the next layer. Logs one full
 * diagnostic line per candidate (title, domain, URL, snippet, decision).
 */
export function refineNewsResults(results: SearchResult[]): SearchResult[] {
  const scored: Array<{ result: SearchResult; index: number; score: number }> = []
  for (const [index, result] of results.entries()) {
    const domain = parsedUrl(result)?.hostname ?? 'invalid-url'
    const detail =
      `"${result.title.slice(0, 70)}" (${domain}) ${result.url} ` +
      `snippet="${result.snippet.slice(0, 80)}"`
    if (looksLikeCategoryPage(result)) {
      console.log(`[websearch:quality] DROP category/landing ${detail}`)
      continue
    }
    const score = scoreArticleLikeness(result)
    console.log(`[websearch:quality] KEEP candidate score=${score} ${detail}`)
    scored.push({ result, index, score })
  }

  const strongCount = scored.filter((entry) => entry.score >= STRONG_ARTICLE_SCORE).length
  const pruned =
    strongCount >= STRONG_NEEDED_TO_PRUNE
      ? scored.filter((entry) => {
          if (entry.score >= WEAK_CUTOFF) return true
          console.log(
            `[websearch:quality] DROP weak score=${entry.score} ` +
              `"${entry.result.title.slice(0, 70)}" — ${strongCount} strong articles available`
          )
          return false
        })
      : scored

  return pruned.sort((a, b) => b.score - a.score || a.index - b.index).map((entry) => entry.result)
}

/**
 * Bounded query fan-out for news searches: the original query plus ONE
 * targeted variant (entity-anchored for AI news, "today"-anchored
 * otherwise) — broad news queries surface hub pages, targeted ones surface
 * articles. Never more than two engine queries; no outlet is hard-coded as
 * a source (entity names only steer the query text).
 */
export function buildNewsQueryVariants(query: string): string[] {
  const variants = [query]
  if (/(^|\W)(ai|a\.i\.)(\W|$)/i.test(query) || /\bopenai|anthropic|deepmind\b/i.test(query)) {
    variants.push(`${query} OpenAI Anthropic Google DeepMind Meta announcement`)
  } else if (!/\btoday\b/i.test(query)) {
    variants.push(`${query} today`)
  }
  return variants.slice(0, 2)
}

/** Merge results from several fetches, deduplicating by normalized URL. */
export function mergeResults(lists: SearchResult[][]): SearchResult[] {
  const seen = new Set<string>()
  const merged: SearchResult[] = []
  for (const list of lists) {
    for (const result of list) {
      const key = parsedUrl(result)?.href ?? result.url
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(result)
    }
  }
  return merged
}
