import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CACHE_TTL_MS,
  WEATHER_LOCATIONS,
  WeatherError,
  describeWeatherCode,
  getWeatherReport,
  parseWeatherResponse,
  resetWeatherCache
} from '../weather'

function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    current: {
      temperature_2m: 12.4,
      apparent_temperature: 9.6,
      weather_code: 3,
      wind_speed_10m: 6.2,
      ...((overrides.current as object) ?? {})
    },
    daily: { temperature_2m_max: [14.2], temperature_2m_min: [7.8] }
  }
}

function mockFetchResponse(status: number, body: unknown): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  resetWeatherCache()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('describeWeatherCode', () => {
  it.each([
    [0, 'Clear', 'sun'],
    [2, 'Partly Cloudy', 'part-cloud'],
    [3, 'Overcast', 'cloud'],
    [45, 'Fog', 'fog'],
    [53, 'Drizzle', 'drizzle'],
    [61, 'Light Rain', 'rain'],
    [65, 'Heavy Rain', 'rain'],
    [71, 'Snow', 'snow'],
    [80, 'Rain Showers', 'rain'],
    [95, 'Thunderstorm', 'thunder'],
    [42, 'Unknown', 'cloud']
  ])('maps WMO code %i to %s / %s', (code, condition, icon) => {
    expect(describeWeatherCode(code)).toEqual({ condition, icon })
  })
})

describe('parseWeatherResponse', () => {
  it('parses both fixed locations with rounded values', () => {
    const report = parseWeatherResponse([entry(), entry({ current: { weather_code: 61 } })], 123)

    expect(report.updatedAt).toBe(123)
    expect(report.locations).toHaveLength(2)
    expect(report.locations[0]).toEqual({
      id: 'sistranda',
      label: 'Sistranda / Frøya',
      temperature: 12,
      feelsLike: 10,
      condition: 'Overcast',
      icon: 'cloud',
      windSpeed: 6,
      high: 14,
      low: 8
    })
    expect(report.locations[1].id).toBe('trondheim')
    expect(report.locations[1].condition).toBe('Light Rain')
  })

  it('falls back to current temperature when daily/apparent data is missing', () => {
    const bare = { current: { temperature_2m: 5.6, weather_code: 0 } }
    const report = parseWeatherResponse([bare, bare], 1)
    expect(report.locations[0]).toMatchObject({ feelsLike: 6, high: 6, low: 6, windSpeed: 0 })
  })

  it.each([
    ['wrong location count', [entry()]],
    ['missing current block', [entry(), {}]],
    ['non-numeric temperature', [entry(), entry({ current: { temperature_2m: 'warm' } })]]
  ])('rejects %s', (_label, data) => {
    expect(() => parseWeatherResponse(data, 0)).toThrow(WeatherError)
  })
})

describe('getWeatherReport', () => {
  it('requests both fixed coordinates from the forecast endpoint', async () => {
    const fetchMock = mockFetchResponse(200, [entry(), entry()])
    await getWeatherReport()

    const url = new URL(fetchMock.mock.calls[0][0])
    expect(url.pathname).toBe('/v1/forecast')
    expect(url.searchParams.get('latitude')).toBe(
      WEATHER_LOCATIONS.map((l) => l.latitude).join(',')
    )
    expect(url.searchParams.get('longitude')).toBe(
      WEATHER_LOCATIONS.map((l) => l.longitude).join(',')
    )
    expect(url.searchParams.get('current')).toContain('apparent_temperature')
    expect(url.searchParams.get('daily')).toContain('temperature_2m_max')
  })

  it('serves cached data within the TTL and refetches after it', async () => {
    vi.useFakeTimers()
    const fetchMock = mockFetchResponse(200, [entry(), entry()])

    await getWeatherReport()
    await getWeatherReport()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(CACHE_TTL_MS + 1000)
    await getWeatherReport()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('honors WEATHER_BASE_URL override', async () => {
    vi.stubEnv('WEATHER_BASE_URL', 'http://localhost:6666')
    const fetchMock = mockFetchResponse(200, [entry(), entry()])
    await getWeatherReport()
    expect(String(fetchMock.mock.calls[0][0])).toContain('http://localhost:6666/forecast')
  })

  it('maps an HTTP error to a WeatherError mentioning the status', async () => {
    mockFetchResponse(503, { error: 'down' })
    await expect(getWeatherReport()).rejects.toThrow(/status 503/)
  })

  it('maps a network failure to a reachability error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
    await expect(getWeatherReport()).rejects.toThrow(/could not reach/i)
  })

  it('maps a timeout to a timeout error', async () => {
    const abortError = new Error('aborted')
    abortError.name = 'TimeoutError'
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError))
    await expect(getWeatherReport()).rejects.toThrow(/timed out/i)
  })

  it('does not cache failures — a later call retries', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
    await expect(getWeatherReport()).rejects.toThrow(WeatherError)

    mockFetchResponse(200, [entry(), entry()])
    await expect(getWeatherReport()).resolves.toMatchObject({ locations: expect.any(Array) })
  })
})
