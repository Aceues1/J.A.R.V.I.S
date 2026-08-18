// Specialized source — live market prices via the Yahoo Finance chart API,
// per the guide: BTC, ETH, and the S&P 500. Structured data only; current
// prices are never answered from model memory.

import { CHROME_UA, WebSearchError } from './types'

const DEFAULT_BASE_URL = 'https://query1.finance.yahoo.com'
const REQUEST_TIMEOUT_MS = 10_000

export interface MarketAsset {
  symbol: string
  label: string
}

export const MARKET_ASSETS: Record<string, MarketAsset> = {
  btc: { symbol: 'BTC-USD', label: 'Bitcoin' },
  eth: { symbol: 'ETH-USD', label: 'Ethereum' },
  sp500: { symbol: '^GSPC', label: 'S&P 500' }
}

/**
 * Detect an explicit current-price query for a supported asset. Conservative:
 * requires both a supported asset mention and price-ish language, so "what is
 * Bitcoin?" (a stable-knowledge question) does not route here.
 */
export function detectMarketQuery(text: string): MarketAsset | null {
  const q = text.toLowerCase()
  const priceish =
    /\b(price|prices|worth|value|cost|costing|trading|quote|rate|at right now|how much|where is|what'?s? .* at)\b/.test(
      q
    ) || /\bat\b.*\b(now|today|the moment|currently)\b/.test(q)
  if (!priceish) return null
  if (/\b(btc|bitcoin)\b/.test(q)) return MARKET_ASSETS.btc
  if (/\b(eth|ethereum)\b/.test(q)) return MARKET_ASSETS.eth
  if (/s\s?&\s?p\s?500|s and p 500|sp500|\bs&p\b/.test(q)) return MARKET_ASSETS.sp500
  return null
}

export interface MarketQuote {
  symbol: string
  label: string
  price: number
  currency: string
  asOf: string | null
}

export async function fetchMarketQuote(asset: MarketAsset): Promise<MarketQuote> {
  const baseUrl = process.env.YAHOO_BASE_URL || DEFAULT_BASE_URL
  const url = `${baseUrl}/v8/finance/chart/${encodeURIComponent(asset.symbol)}?range=1d&interval=5m`

  let response: Response
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': CHROME_UA, 'Cache-Control': 'no-cache' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      console.error('[websearch:market] timed out')
      throw new WebSearchError('The market data service timed out.')
    }
    console.error('[websearch:market] network error', error)
    throw new WebSearchError('The market data service could not be reached.')
  }

  if (!response.ok) {
    console.error('[websearch:market] HTTP', response.status)
    throw new WebSearchError(
      `The market data service returned an error (status ${response.status}).`
    )
  }

  let data: unknown
  try {
    data = await response.json()
  } catch (error) {
    console.error('[websearch:market] invalid JSON', error)
    throw new WebSearchError('The market data service returned an unreadable response.')
  }

  const meta = (data as { chart?: { result?: Array<{ meta?: Record<string, unknown> }> } })?.chart
    ?.result?.[0]?.meta
  const price = meta?.regularMarketPrice
  if (typeof price !== 'number' || !Number.isFinite(price)) {
    console.error('[websearch:market] unexpected response shape')
    throw new WebSearchError('The market data service returned an unexpected response.')
  }
  const time = meta?.regularMarketTime
  return {
    symbol: asset.symbol,
    label: asset.label,
    price,
    currency: typeof meta?.currency === 'string' ? meta.currency : 'USD',
    asOf: typeof time === 'number' ? new Date(time * 1000).toISOString() : null
  }
}
