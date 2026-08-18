import { afterEach, describe, expect, it, vi } from 'vitest'
import { braveConfigured, searchBrave } from '../brave'
import { WebSearchError } from '../types'

const BRAVE_RESPONSE = {
  web: {
    results: [
      {
        title: 'Brave <strong>Result</strong> One',
        url: 'https://one.example.com/a',
        description: 'First <em>description</em>.'
      },
      { title: 'Result Two', url: 'https://two.example.com/b', description: 'Second.' },
      { title: '', url: 'https://empty.example.com', description: 'dropped: empty title' },
      { title: 'Dup', url: 'https://one.example.com/a', description: 'dropped: duplicate' }
    ]
  }
}

function mockFetch(status: number, body: unknown): ReturnType<typeof vi.fn> {
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

describe('braveConfigured', () => {
  it('is false without a key and true with one — the layer is strictly optional', () => {
    vi.stubEnv('BRAVE_SEARCH_API_KEY', '')
    expect(braveConfigured()).toBe(false)
    vi.stubEnv('BRAVE_SEARCH_API_KEY', 'brave-key')
    expect(braveConfigured()).toBe(true)
  })
})

describe('searchBrave', () => {
  it('refuses to run without a key instead of crashing', async () => {
    vi.stubEnv('BRAVE_SEARCH_API_KEY', '')
    const fetchMock = mockFetch(200, BRAVE_RESPONSE)
    await expect(searchBrave('x')).rejects.toThrow('Brave Search is not configured.')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('calls the Brave API with the subscription token and parses results', async () => {
    vi.stubEnv('BRAVE_SEARCH_API_KEY', 'brave-key')
    const fetchMock = mockFetch(200, BRAVE_RESPONSE)
    const results = await searchBrave('ai news & today')

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe(
      'https://api.search.brave.com/res/v1/web/search?q=ai%20news%20%26%20today&count=8'
    )
    expect(init.headers['X-Subscription-Token']).toBe('brave-key')
    expect(results).toHaveLength(2)
    expect(results[0]).toEqual({
      title: 'Brave Result One',
      url: 'https://one.example.com/a',
      snippet: 'First description.',
      source: 'Brave Search'
    })
  })

  it('reports API failure as WebSearchError', async () => {
    vi.stubEnv('BRAVE_SEARCH_API_KEY', 'brave-key')
    mockFetch(401, {})
    await expect(searchBrave('x')).rejects.toThrow('status 401')
  })

  it('reports malformed responses as WebSearchError', async () => {
    vi.stubEnv('BRAVE_SEARCH_API_KEY', 'brave-key')
    mockFetch(200, 'not-json')
    await expect(searchBrave('x')).rejects.toThrow('unreadable response')

    mockFetch(200, { unexpected: 'shape' })
    await expect(searchBrave('x')).rejects.toThrow(WebSearchError)
  })

  it('reports network failure as WebSearchError', async () => {
    vi.stubEnv('BRAVE_SEARCH_API_KEY', 'brave-key')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('down')))
    await expect(searchBrave('x')).rejects.toThrow('Brave Search could not be reached.')
  })
})
