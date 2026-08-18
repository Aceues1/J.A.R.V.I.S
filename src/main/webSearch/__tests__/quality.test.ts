import { describe, expect, it } from 'vitest'
import {
  isNewsQuery,
  looksLikeCategoryPage,
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
