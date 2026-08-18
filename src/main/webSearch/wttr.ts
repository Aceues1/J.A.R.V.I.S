// Specialized source — weather for locations OUTSIDE the existing dedicated
// Open-Meteo feed, via the guide's wttr.in JSON endpoint. The existing
// Sistranda/Frøya + Trondheim system is untouched and always wins for its
// own locations; this path only handles "what's the weather in London?".

import { CHROME_UA, WebSearchError } from './types'

const DEFAULT_BASE_URL = 'https://wttr.in'
const REQUEST_TIMEOUT_MS = 10_000

// Locations already covered by the dedicated live weather feed.
const EXISTING_FEED_RE = /\b(sistranda|fr[øo]ya|trondheim)\b/i

export function isExistingWeatherLocation(text: string): boolean {
  return EXISTING_FEED_RE.test(text)
}

/**
 * Extract "weather in <place>" style locations. Returns null for the
 * locations the dedicated feed covers, and for weather questions with no
 * explicit other location (those belong to the existing feed too).
 */
export function detectOtherLocationWeather(text: string): string | null {
  if (!/\b(weather|temperature|forecast|raining|snowing|how (cold|warm|hot))\b/i.test(text)) {
    return null
  }
  if (isExistingWeatherLocation(text)) return null
  const match = text.match(/\b(?:in|for|at)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s.'-]{1,40}?)\s*[?.!]*$/)
  if (!match) return null
  const location = match[1].trim()
  if (!location || /^(the moment|now|here|there|general)$/i.test(location)) return null
  return location
}

export interface WttrWeather {
  location: string
  temperatureC: number
  feelsLikeC: number | null
  description: string
  observedAt: string | null
}

export async function fetchWttrWeather(location: string): Promise<WttrWeather> {
  const baseUrl = process.env.WTTR_BASE_URL || DEFAULT_BASE_URL
  const url = `${baseUrl}/${encodeURIComponent(location)}?format=j1`

  let response: Response
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': CHROME_UA, 'Cache-Control': 'no-cache' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      console.error('[websearch:wttr] timed out')
      throw new WebSearchError('The weather lookup timed out.')
    }
    console.error('[websearch:wttr] network error', error)
    throw new WebSearchError('The weather lookup service could not be reached.')
  }

  if (!response.ok) {
    console.error('[websearch:wttr] HTTP', response.status)
    throw new WebSearchError(`The weather lookup returned an error (status ${response.status}).`)
  }

  let data: unknown
  try {
    data = await response.json()
  } catch (error) {
    console.error('[websearch:wttr] invalid JSON', error)
    throw new WebSearchError('The weather lookup returned an unreadable response.')
  }

  const current = (data as { current_condition?: Array<Record<string, unknown>> })
    ?.current_condition?.[0]
  const temp = Number(current?.temp_C)
  if (!current || !Number.isFinite(temp)) {
    console.error('[websearch:wttr] unexpected response shape')
    throw new WebSearchError('The weather lookup returned an unexpected response.')
  }
  const feels = Number(current.FeelsLikeC)
  const descriptionValue = (current.weatherDesc as Array<{ value?: unknown }> | undefined)?.[0]
    ?.value
  return {
    location,
    temperatureC: temp,
    feelsLikeC: Number.isFinite(feels) ? feels : null,
    description: typeof descriptionValue === 'string' ? descriptionValue : 'Unknown',
    observedAt:
      typeof current.localObsDateTime === 'string' ? (current.localObsDateTime as string) : null
  }
}
