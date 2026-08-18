// Web-search self-test: exercises each live source individually from the
// MAIN process, without needing the model or the renderer. Enable with
// JARVIS_WEBSEARCH_DEBUG=1 before `npm run dev` — results print to the
// terminal only. Never exposes keys; never sends anything to the renderer.

import { searchDuckDuckGo } from './duckduckgo'
import { braveConfigured, searchBrave } from './brave'
import { fetchTechCrunchAiNews } from './techcrunch'
import { fetchMarketQuote, MARKET_ASSETS } from './market'
import { fetchWttrWeather } from './wttr'
import { runSearchGate } from './gate'

function ok(name: string, detail: string): void {
  console.log(`[websearch:selftest] PASS ${name} — ${detail}`)
}

function fail(name: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[websearch:selftest] FAIL ${name} — ${message}`)
}

export function selfTestEnabled(): boolean {
  return Boolean(process.env.JARVIS_WEBSEARCH_DEBUG)
}

/**
 * Runs each source once and reports PASS/FAIL per layer. Distinguishes:
 * network failure vs HTTP rejection vs parser failure (each source's error
 * message says which) — and tests the gate separately since only the gate
 * needs the model.
 */
export async function runWebSearchSelfTest(): Promise<void> {
  console.log('[websearch:selftest] --- live web search self-test starting ---')

  try {
    const results = await searchDuckDuckGo('latest technology news')
    if (results.length > 0) {
      ok('DuckDuckGo', `${results.length} results; first: "${results[0].title.slice(0, 60)}"`)
    } else {
      fail('DuckDuckGo', 'HTTP OK but 0 results parsed — page preview logged above (parser issue)')
    }
  } catch (error) {
    fail('DuckDuckGo', error)
  }

  if (braveConfigured()) {
    try {
      const results = await searchBrave('latest technology news')
      ok('Brave', `${results.length} results`)
    } catch (error) {
      fail('Brave', error)
    }
  } else {
    console.log('[websearch:selftest] SKIP Brave — no BRAVE_SEARCH_API_KEY configured')
  }

  try {
    const quote = await fetchMarketQuote(MARKET_ASSETS.btc)
    ok('Yahoo Finance', `BTC-USD ${quote.price} ${quote.currency} as of ${quote.asOf ?? 'n/a'}`)
  } catch (error) {
    fail('Yahoo Finance', error)
  }

  try {
    const weather = await fetchWttrWeather('London')
    ok('wttr.in', `London ${weather.temperatureC}°C, ${weather.description}`)
  } catch (error) {
    fail('wttr.in', error)
  }

  try {
    const items = await fetchTechCrunchAiNews()
    ok('TechCrunch RSS', `${items.length} items; first: "${items[0].title.slice(0, 60)}"`)
  } catch (error) {
    fail('TechCrunch RSS', error)
  }

  // The gate is the only piece that needs the model. Its own [websearch:gate]
  // logs show the decision path in detail.
  try {
    const decision = await runSearchGate([{ role: 'user', content: 'What is the latest AI news?' }])
    if (decision.search) {
      ok('Search gate', `search=true query="${decision.query}"`)
    } else {
      fail(
        'Search gate',
        'returned search=false for a clearly live query — see [websearch:gate] logs above'
      )
    }
  } catch (error) {
    fail('Search gate', error)
  }

  console.log('[websearch:selftest] --- self-test complete ---')
}
