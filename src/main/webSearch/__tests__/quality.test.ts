import { describe, expect, it } from 'vitest'
import {
  buildNewsQueryVariants,
  isNewsQuery,
  looksLikeCategoryPage,
  mergeResults,
  refineNewsResults,
  scoreArticleLikeness
} from '../quality'
import type { SearchResult } from '../types'

const result = (title: string, url: string, extra: Partial<SearchResult> = {}): SearchResult => ({
  title,
  url,
  snippet: '',
  source: 'DuckDuckGo',
  ...extra
})

describe('isNewsQuery', () => {
  it.each(['latest AI news', 'OpenAI news today', 'what happened in AI today', 'breaking updates'])(
    'treats %j as a news query',
    (q) => expect(isNewsQuery(q)).toBe(true)
  )
  it.each(['best pizza in rome', 'weather in London', 'bitcoin price', 'how to train a model'])(
    'does not treat %j as a news query',
    (q) => expect(isNewsQuery(q)).toBe(false)
  )
})

describe('looksLikeCategoryPage — the real Windows failure cases', () => {
  it.each([
    // exactly what the live search returned for "latest AI news":
    [
      'Artificial intelligence – Latest',
      'https://news.google.com/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRzFyZWpJU0FtVnVHZ0pWVXlnQVAB'
    ],
    [
      'Artificial Intelligence | TechCrunch',
      'https://techcrunch.com/category/artificial-intelligence/'
    ],
    ['Artificial Intelligence', 'https://www.reuters.com/technology/artificial-intelligence/'],
    ['AI News', 'https://www.artificialintelligence-news.com/'],
    ['AI Weekly', 'https://aiweekly.co/'],
    [
      'Artificial intelligence – Latest news and top stories',
      'https://example-news.com/topics/ai/'
    ],
    ['Tech News', 'https://example.com/tag/tech/'],
    ['Search results', 'https://outlet.example.com/search?q=ai']
  ])('rejects the section/landing page %j (%s)', (title, url) => {
    expect(looksLikeCategoryPage(result(title, url))).toBe(true)
  })

  it.each([
    // legitimate articles must NEVER be rejected:
    [
      'OpenAI launches GPT-6 with real-time voice',
      'https://techcrunch.com/2026/08/18/openai-launches-gpt-6/'
    ],
    [
      'Anthropic raises $10B at record valuation',
      'https://www.reuters.com/technology/anthropic-raises-10b-2026-08-17/'
    ],
    // article nested under a /category/ path but carrying a date — kept:
    [
      'DeepMind breakthrough in protein folding',
      'https://outlet.example.com/category/ai/2026/08/deepmind-breakthrough/'
    ],
    // a direct Google News article link — kept:
    ['Meta unveils new AI chip', 'https://news.google.com/articles/CBMiSWh0dHBz'],
    // generic-word slug but deep, headline-style URL — kept:
    [
      'The state of AI regulation in Europe',
      'https://example.com/2026/08/the-state-of-ai-regulation-in-europe'
    ]
  ])('keeps the article %j (%s)', (title, url) => {
    expect(looksLikeCategoryPage(result(title, url))).toBe(false)
  })
})

describe('scoreArticleLikeness + ranking', () => {
  it('scores dated, slugged, snippeted articles above shallow undated pages', () => {
    const strong = result(
      'OpenAI launches GPT-6',
      'https://tc.example.com/2026/08/18/openai-launches-gpt-6-today/',
      {
        snippet:
          'OpenAI announced GPT-6 on Monday with real-time voice and a new pricing tier for developers.',
        publishedAt: 'Mon, 18 Aug 2026'
      }
    )
    const weak = result('Some page', 'https://example.com/page')
    expect(scoreArticleLikeness(strong)).toBeGreaterThan(scoreArticleLikeness(weak))
  })

  it('refineNewsResults drops category pages and ranks article-like results first', () => {
    const refined = refineNewsResults([
      result(
        'Artificial Intelligence | TechCrunch',
        'https://techcrunch.com/category/artificial-intelligence/'
      ),
      result('Some undated page', 'https://example.com/page'),
      result(
        'OpenAI launches GPT-6 with voice',
        'https://tc.example.com/2026/08/18/openai-launches-gpt-6-voice/',
        {
          snippet:
            'OpenAI announced GPT-6 on Monday, adding native real-time voice across all product tiers.'
        }
      ),
      result('AI Weekly', 'https://aiweekly.co/')
    ])
    expect(refined.map((r) => r.title)).toEqual([
      'OpenAI launches GPT-6 with voice',
      'Some undated page'
    ])
  })

  it('keeps engine order for equally scored results (stable ranking)', () => {
    const a = result('First story', 'https://a.example.com/2026/08/first-story-of-the-day-here')
    const b = result('Second story', 'https://b.example.com/2026/08/second-story-of-the-day-now')
    expect(refineNewsResults([a, b]).map((r) => r.title)).toEqual(['First story', 'Second story'])
  })

  it('ranks recent publication dates above stale ones — never fabricating a date', () => {
    const base = 'https://outlet.example.com/2026/08/some-specific-ai-story-here/'
    const fresh = result('Story', base, {
      publishedAt: new Date(Date.now() - 3600_000).toUTCString()
    })
    const stale = result('Story', base, { publishedAt: 'Mon, 01 Jan 2024 00:00:00 +0000' })
    const undated = result('Story', base)
    expect(scoreArticleLikeness(fresh)).toBeGreaterThan(scoreArticleLikeness(stale))
    expect(scoreArticleLikeness(stale)).toBeGreaterThan(scoreArticleLikeness(undated))
  })

  it('the second-round Windows offenders are pruned when real articles exist', () => {
    const recent = new Date(Date.now() - 3600_000).toUTCString()
    const article = (n: number): SearchResult =>
      result(
        `Concrete AI story ${n}`,
        `https://tc.example.com/2026/08/18/concrete-ai-story-number-${n}/`,
        {
          snippet: `Company ${n} shipped a specific model with benchmark numbers and pricing today.`,
          publishedAt: recent
        }
      )
    const refined = refineNewsResults([
      // exactly what the second Windows test surfaced:
      result(
        'Reuters AI roundup: artificial intelligence coverage',
        'https://www.reuters.com/technology/ai-roundup/'
      ),
      result('The AI Race', 'https://www.bloomberg.com/ai-race'),
      result('AI Tools Recap – Daily AI News Summary', 'https://aitoolsrecap.com/daily'),
      article(1),
      article(2),
      article(3)
    ])
    expect(refined.map((r) => r.title)).toEqual([
      'Concrete AI story 1',
      'Concrete AI story 2',
      'Concrete AI story 3'
    ])
  })

  it('keeps the offenders when nothing better exists — pruning needs strong articles', () => {
    const refined = refineNewsResults([
      result('The AI Race', 'https://www.bloomberg.com/ai-race'),
      result('AI Tools Recap – Daily AI News Summary', 'https://aitoolsrecap.com/daily')
    ])
    expect(refined).toHaveLength(2)
  })

  it('keeps real dated articles from the offending outlets — no domain blacklist', () => {
    const reuters = result(
      'Anthropic signs $5B compute deal',
      'https://www.reuters.com/technology/anthropic-signs-5b-compute-deal-2026-08-18/',
      {
        snippet:
          'Anthropic agreed a five billion dollar multi-year compute deal, sources said on Monday.'
      }
    )
    const bloomberg = result(
      'OpenAI revenue hits new record',
      'https://www.bloomberg.com/news/articles/2026-08-18/openai-revenue-hits-new-record',
      {
        snippet:
          'OpenAI posted record revenue for the quarter, according to people familiar with the matter.'
      }
    )
    expect(looksLikeCategoryPage(reuters)).toBe(false)
    expect(looksLikeCategoryPage(bloomberg)).toBe(false)
    expect(scoreArticleLikeness(bloomberg)).toBeGreaterThanOrEqual(3)
  })

  it('a roundup carrying concrete dated stories survives pruning', () => {
    const recent = new Date(Date.now() - 3600_000).toUTCString()
    const strongArticles = [1, 2, 3].map((n) =>
      result(
        `Concrete AI story ${n}`,
        `https://tc.example.com/2026/08/18/concrete-ai-story-number-${n}/`,
        {
          snippet: `Company ${n} shipped a specific model with benchmark numbers and pricing today.`,
          publishedAt: recent
        }
      )
    )
    const usefulRoundup = result(
      'AI roundup: OpenAI ships GPT-6, Meta releases Llama 5',
      'https://outlet.example.com/2026/08/18/ai-roundup-openai-gpt6-meta-llama5/',
      {
        snippet:
          'OpenAI shipped GPT-6 with realtime voice while Meta released Llama 5 weights on Monday.'
      }
    )
    const refined = refineNewsResults([...strongArticles, usefulRoundup])
    expect(refined.map((r) => r.title)).toContain(
      'AI roundup: OpenAI ships GPT-6, Meta releases Llama 5'
    )
  })

  it('returns empty when every result is a category page — triggering fallback', () => {
    expect(
      refineNewsResults([
        result(
          'Artificial Intelligence',
          'https://www.reuters.com/technology/artificial-intelligence/'
        ),
        result('AI News', 'https://www.artificialintelligence-news.com/')
      ])
    ).toEqual([])
  })
})

describe('buildNewsQueryVariants — bounded fan-out', () => {
  it('anchors AI-news queries with entity names, capped at two queries', () => {
    const variants = buildNewsQueryVariants('latest AI news')
    expect(variants).toHaveLength(2)
    expect(variants[0]).toBe('latest AI news')
    expect(variants[1]).toContain('OpenAI Anthropic Google DeepMind Meta')
  })

  it('anchors non-AI news queries with "today" instead', () => {
    expect(buildNewsQueryVariants('latest football news')[1]).toBe('latest football news today')
  })

  it('never duplicates "today" and never exceeds two variants', () => {
    const variants = buildNewsQueryVariants('football news today')
    expect(variants).toEqual(['football news today'])
  })
})

describe('mergeResults', () => {
  it('merges multiple lists deduplicating by URL, preserving first occurrence', () => {
    const a = result('A', 'https://x.example.com/one')
    const dupe = result('A duplicate', 'https://x.example.com/one')
    const b = result('B', 'https://x.example.com/two')
    const merged = mergeResults([[a], [dupe, b]])
    expect(merged.map((r) => r.title)).toEqual(['A', 'B'])
  })
})
