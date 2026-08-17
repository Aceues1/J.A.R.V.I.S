// Live weather for the HUD via Open-Meteo (https://open-meteo.com) — free,
// reliable, and keyless, so there is no secret to protect; fetching still
// happens in the main process like all other network traffic, keeping the
// renderer CSP locked down. Locations are fixed: the HUD always monitors
// Sistranda/Frøya and Trondheim.
const DEFAULT_BASE_URL = 'https://api.open-meteo.com/v1'
const REQUEST_TIMEOUT_MS = 15_000
// Serve from cache within this window so UI refreshes never hammer the API.
export const CACHE_TTL_MS = 5 * 60_000

export class WeatherError extends Error {}

export const WEATHER_LOCATIONS = [
  { id: 'sistranda', label: 'Sistranda / Frøya', latitude: 63.7256, longitude: 8.834 },
  { id: 'trondheim', label: 'Trondheim', latitude: 63.4305, longitude: 10.3951 }
] as const

export type WeatherIcon =
  'sun' | 'part-cloud' | 'cloud' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'thunder'

export interface LocationWeather {
  id: string
  label: string
  temperature: number
  feelsLike: number
  condition: string
  icon: WeatherIcon
  windSpeed: number
  high: number
  low: number
}

export interface WeatherReport {
  updatedAt: number
  locations: LocationWeather[]
}

// WMO weather interpretation codes, as used by Open-Meteo.
export function describeWeatherCode(code: number): { condition: string; icon: WeatherIcon } {
  if (code === 0) return { condition: 'Clear', icon: 'sun' }
  if (code === 1) return { condition: 'Mostly Clear', icon: 'part-cloud' }
  if (code === 2) return { condition: 'Partly Cloudy', icon: 'part-cloud' }
  if (code === 3) return { condition: 'Overcast', icon: 'cloud' }
  if (code === 45 || code === 48) return { condition: 'Fog', icon: 'fog' }
  if (code >= 51 && code <= 57) return { condition: 'Drizzle', icon: 'drizzle' }
  if (code === 61 || code === 66) return { condition: 'Light Rain', icon: 'rain' }
  if (code === 63) return { condition: 'Rain', icon: 'rain' }
  if (code === 65 || code === 67) return { condition: 'Heavy Rain', icon: 'rain' }
  if (code >= 71 && code <= 77) return { condition: 'Snow', icon: 'snow' }
  if (code >= 80 && code <= 82) return { condition: 'Rain Showers', icon: 'rain' }
  if (code === 85 || code === 86) return { condition: 'Snow Showers', icon: 'snow' }
  if (code >= 95) return { condition: 'Thunderstorm', icon: 'thunder' }
  return { condition: 'Unknown', icon: 'cloud' }
}

interface OpenMeteoEntry {
  current?: {
    temperature_2m?: number
    apparent_temperature?: number
    weather_code?: number
    wind_speed_10m?: number
  }
  daily?: {
    temperature_2m_max?: number[]
    temperature_2m_min?: number[]
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function parseWeatherResponse(data: unknown, now: number): WeatherReport {
  // Open-Meteo returns an array when multiple coordinates are requested.
  const entries = Array.isArray(data) ? data : [data]
  if (entries.length !== WEATHER_LOCATIONS.length) {
    throw new WeatherError('Weather service returned an unexpected response.')
  }

  const locations = WEATHER_LOCATIONS.map((location, index) => {
    const entry = entries[index] as OpenMeteoEntry | null
    const current = entry?.current
    const daily = entry?.daily
    if (
      !current ||
      !isFiniteNumber(current.temperature_2m) ||
      !isFiniteNumber(current.weather_code)
    ) {
      throw new WeatherError('Weather service returned an unexpected response.')
    }

    const { condition, icon } = describeWeatherCode(current.weather_code)
    const high = daily?.temperature_2m_max?.[0]
    const low = daily?.temperature_2m_min?.[0]

    return {
      id: location.id,
      label: location.label,
      temperature: Math.round(current.temperature_2m),
      feelsLike: Math.round(
        isFiniteNumber(current.apparent_temperature)
          ? current.apparent_temperature
          : current.temperature_2m
      ),
      condition,
      icon,
      windSpeed: isFiniteNumber(current.wind_speed_10m) ? Math.round(current.wind_speed_10m) : 0,
      high: Math.round(isFiniteNumber(high) ? high : current.temperature_2m),
      low: Math.round(isFiniteNumber(low) ? low : current.temperature_2m)
    }
  })

  return { updatedAt: now, locations }
}

let cachedReport: WeatherReport | null = null

async function fetchWeather(): Promise<WeatherReport> {
  const baseUrl = process.env.WEATHER_BASE_URL || DEFAULT_BASE_URL
  const params = new URLSearchParams({
    latitude: WEATHER_LOCATIONS.map((l) => l.latitude).join(','),
    longitude: WEATHER_LOCATIONS.map((l) => l.longitude).join(','),
    current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m',
    daily: 'temperature_2m_max,temperature_2m_min',
    forecast_days: '1',
    timezone: 'Europe/Oslo',
    wind_speed_unit: 'ms'
  })

  let response: Response
  try {
    response = await fetch(`${baseUrl}/forecast?${params}`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      console.error('[weather] request timed out')
      throw new WeatherError('Weather service timed out.')
    }
    console.error('[weather] network error', error)
    throw new WeatherError('Could not reach the weather service.')
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '')
    console.error('[weather] request failed', response.status, bodyText.slice(0, 300))
    throw new WeatherError(`Weather service returned an error (status ${response.status}).`)
  }

  let data: unknown
  try {
    data = await response.json()
  } catch (error) {
    console.error('[weather] invalid JSON in response', error)
    throw new WeatherError('Weather service returned an unreadable response.')
  }

  return parseWeatherResponse(data, Date.now())
}

/** Returns fresh-enough cached data, otherwise fetches and caches. */
export async function getWeatherReport(): Promise<WeatherReport> {
  if (cachedReport && Date.now() - cachedReport.updatedAt < CACHE_TTL_MS) {
    return cachedReport
  }
  cachedReport = await fetchWeather()
  return cachedReport
}

/** Test hook: clear the module-level cache. */
export function resetWeatherCache(): void {
  cachedReport = null
}

// ---- Chat integration ------------------------------------------------------
// The chat layer injects a compact live-weather block into the system prompt
// so JARVIS answers weather questions from real data instead of model
// knowledge. On failure it injects an explicit "unavailable" note so the
// model says so honestly rather than inventing values.

export const WEATHER_UNAVAILABLE_CONTEXT =
  '# Live weather feed\n' +
  'Live weather data is temporarily unavailable. If asked about current weather, say exactly ' +
  'that — do not guess, estimate, or invent current conditions.'

export function formatWeatherForPrompt(report: WeatherReport): string {
  const updated = new Date(report.updatedAt).toLocaleTimeString([], { hour12: false })
  const lines = report.locations.map(
    (l) =>
      `- ${l.label}: ${l.temperature}°C (feels like ${l.feelsLike}°C), ${l.condition}, ` +
      `wind ${l.windSpeed} m/s, today's high ${l.high}°C / low ${l.low}°C.`
  )
  return (
    '# Live weather feed\n' +
    `Current conditions (updated ${updated}):\n` +
    `${lines.join('\n')}\n` +
    'Answer questions about current weather in these locations from this data only, not from ' +
    'memory. Frøya and Sistranda refer to the first entry.'
  )
}

/**
 * Never throws and never stalls the chat: a cold fetch that exceeds maxWaitMs
 * falls back to the unavailable note while the fetch continues in the
 * background to warm the cache for the next turn.
 */
export async function getWeatherPromptContext(maxWaitMs = 2500): Promise<string> {
  try {
    const report = await Promise.race([
      getWeatherReport(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new WeatherError('Weather fetch too slow for chat.')), maxWaitMs)
      )
    ])
    return formatWeatherForPrompt(report)
  } catch {
    return WEATHER_UNAVAILABLE_CONTEXT
  }
}
