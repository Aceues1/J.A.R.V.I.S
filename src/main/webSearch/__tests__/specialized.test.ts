import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectMarketQuery, fetchMarketQuote, MARKET_ASSETS } from '../market'
import { detectOtherLocationWeather, fetchWttrWeather, isExistingWeatherLocation } from '../wttr'
import { detectInstagramQuery, fetchInstagramFollowers } from '../instagram'

function mockJsonFetch(status: number, body: unknown): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () =>
      typeof body === 'string' ? Promise.reject(new Error('bad json')) : Promise.resolve(body)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('market routing', () => {
  it.each([
    ["What's Bitcoin at right now?", 'BTC-USD'],
    ['bitcoin price today', 'BTC-USD'],
    ['How much is ETH?', 'ETH-USD'],
    ['ethereum price', 'ETH-USD'],
    ['Where is the S&P 500?', '^GSPC'],
    ['sp500 price now', '^GSPC']
  ])('routes %j to %s', (query, symbol) => {
    expect(detectMarketQuery(query)?.symbol).toBe(symbol)
  })

  it.each([
    'what is bitcoin', // stable knowledge — not a price request
    'tell me about ethereum mining',
    'what is the price of eggs', // price-ish but unsupported asset
    'latest AI news'
  ])('does NOT route %j to a market source', (query) => {
    expect(detectMarketQuery(query)).toBeNull()
  })

  it('fetches the Yahoo chart API and extracts price/currency/time', async () => {
    const fetchMock = mockJsonFetch(200, {
      chart: {
        result: [
          { meta: { regularMarketPrice: 97432.1, currency: 'USD', regularMarketTime: 1755500000 } }
        ]
      }
    })
    const quote = await fetchMarketQuote(MARKET_ASSETS.btc)
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'https://query1.finance.yahoo.com/v8/finance/chart/BTC-USD?range=1d&interval=5m'
    )
    expect(quote.price).toBe(97432.1)
    expect(quote.currency).toBe('USD')
    expect(quote.asOf).toBe(new Date(1755500000 * 1000).toISOString())
  })

  it('treats malformed market responses as failures, never inventing a price', async () => {
    mockJsonFetch(200, { chart: { result: [{ meta: {} }] } })
    await expect(fetchMarketQuote(MARKET_ASSETS.eth)).rejects.toThrow('unexpected response')
    mockJsonFetch(200, 'not json')
    await expect(fetchMarketQuote(MARKET_ASSETS.eth)).rejects.toThrow('unreadable response')
    mockJsonFetch(500, {})
    await expect(fetchMarketQuote(MARKET_ASSETS.eth)).rejects.toThrow('status 500')
  })
})

describe('other-location weather routing', () => {
  it('keeps the dedicated feed locations OUT of the web path', () => {
    expect(isExistingWeatherLocation('weather in Trondheim')).toBe(true)
    expect(isExistingWeatherLocation('what about Frøya?')).toBe(true)
    expect(isExistingWeatherLocation('froya forecast')).toBe(true)
    expect(isExistingWeatherLocation('sistranda temperature')).toBe(true)
    expect(detectOtherLocationWeather("what's the weather in Trondheim?")).toBeNull()
    expect(detectOtherLocationWeather('weather in sistranda')).toBeNull()
  })

  it('extracts other locations from weather questions', () => {
    expect(detectOtherLocationWeather('What is the weather in London?')).toBe('London')
    expect(detectOtherLocationWeather('temperature in New York')).toBe('New York')
    expect(detectOtherLocationWeather('is it raining in Oslo')).toBe('Oslo')
  })

  it('returns null for weather questions with no explicit other location', () => {
    expect(detectOtherLocationWeather("what's the weather like?")).toBeNull()
    expect(detectOtherLocationWeather('how cold is it right now')).toBeNull()
    expect(detectOtherLocationWeather('tell me about london')).toBeNull()
  })

  it('fetches wttr.in j1 JSON and extracts current conditions', async () => {
    const fetchMock = mockJsonFetch(200, {
      current_condition: [
        {
          temp_C: '14',
          FeelsLikeC: '12',
          weatherDesc: [{ value: 'Partly cloudy' }],
          localObsDateTime: '2026-08-18 02:00 PM'
        }
      ]
    })
    const weather = await fetchWttrWeather('London')
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://wttr.in/London?format=j1')
    expect(weather).toEqual({
      location: 'London',
      temperatureC: 14,
      feelsLikeC: 12,
      description: 'Partly cloudy',
      observedAt: '2026-08-18 02:00 PM'
    })
  })

  it('treats malformed wttr responses as failures', async () => {
    mockJsonFetch(200, { current_condition: [] })
    await expect(fetchWttrWeather('London')).rejects.toThrow('unexpected response')
    mockJsonFetch(200, 'not json')
    await expect(fetchWttrWeather('London')).rejects.toThrow('unreadable response')
  })
})

describe('Instagram follower routing', () => {
  it.each([
    ['how many followers does cristiano have on instagram', 'cristiano'],
    ["what's nasa's instagram followers", 'nasa'],
    ['instagram followers of @nasa', 'nasa'],
    ['nasa insta followers?', 'nasa']
  ])('extracts the username from %j', (query, username) => {
    expect(detectInstagramQuery(query)).toBe(username)
  })

  it.each([
    'how many followers does nasa have', // no instagram mention
    'open instagram', // no follower question
    'tell me about instagram',
    "what's the latest AI news"
  ])('does NOT route %j to Instagram', (query) => {
    expect(detectInstagramQuery(query)).toBeNull()
  })

  it('fetches the follower count with the app-id header', async () => {
    const fetchMock = mockJsonFetch(200, {
      data: { user: { edge_followed_by: { count: 361000000 } } }
    })
    const result = await fetchInstagramFollowers('cristiano')
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe(
      'https://i.instagram.com/api/v1/users/web_profile_info/?username=cristiano'
    )
    expect(init.headers['X-IG-App-ID']).toBeTruthy()
    expect(result).toEqual({ username: 'cristiano', followers: 361000000 })
  })

  it('reports a refusal honestly instead of inventing a count', async () => {
    mockJsonFetch(403, {})
    await expect(fetchInstagramFollowers('cristiano')).rejects.toThrow(
      'Instagram declined the request (status 403)'
    )
    mockJsonFetch(200, { data: { user: {} } })
    await expect(fetchInstagramFollowers('cristiano')).rejects.toThrow('unexpected response')
  })
})
