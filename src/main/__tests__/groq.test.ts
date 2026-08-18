import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GroqConfigError,
  GroqRequestError,
  MAX_SENT_MESSAGE_CHARS,
  MAX_SENT_TURNS,
  getGroqStatus,
  requestGroqReply,
  trimHistoryForPrompt
} from '../groq'
import { SYSTEM_PROMPT } from '../persona'
import { resetWeatherCache } from '../weather'

const weatherEntry = (code: number, temp: number): object => ({
  current: {
    temperature_2m: temp,
    apparent_temperature: temp - 2,
    weather_code: code,
    wind_speed_10m: 5.1
  },
  daily: { temperature_2m_max: [temp + 2], temperature_2m_min: [temp - 3] }
})

/** Routes /forecast and /chat/completions separately; weatherOk=false fails the feed. */
function mockRoutedFetch(chatBody: unknown, weatherOk = true): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockImplementation((url: string) => {
    if (String(url).includes('/forecast')) {
      if (!weatherOk) return Promise.reject(new TypeError('fetch failed'))
      const body = [weatherEntry(3, 12.4), weatherEntry(61, 10.2)]
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify(body)),
        json: () => Promise.resolve(body)
      })
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(chatBody)),
      json: () => Promise.resolve(chatBody)
    })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function chatCallBody(fetchMock: ReturnType<typeof vi.fn>): {
  messages: Array<{ role: string; content: string }>
} {
  const call = fetchMock.mock.calls.find((c) => String(c[0]).includes('/chat/completions'))
  return JSON.parse(call![1].body)
}

const history = [{ role: 'user' as const, content: 'hello' }]

function mockFetchResponse(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
      json: () =>
        typeof body === 'string' ? Promise.reject(new Error('not json')) : Promise.resolve(body)
    })
  )
}

beforeEach(() => {
  vi.stubEnv('GROQ_API_KEY', 'test-key')
  resetWeatherCache()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('getGroqStatus', () => {
  it('reports configured with the default model', () => {
    expect(getGroqStatus()).toEqual({ configured: true, model: 'openai/gpt-oss-120b' })
  })

  it('reports unconfigured when the key is missing', () => {
    vi.stubEnv('GROQ_API_KEY', '')
    expect(getGroqStatus().configured).toBe(false)
  })

  it('honors GROQ_MODEL override', () => {
    vi.stubEnv('GROQ_MODEL', 'custom-model')
    expect(getGroqStatus().model).toBe('custom-model')
  })
})

describe('requestGroqReply', () => {
  it('returns the assistant message content on success', async () => {
    mockFetchResponse(200, { choices: [{ message: { content: 'Hi there.' } }] })
    await expect(requestGroqReply(history)).resolves.toBe('Hi there.')
  })

  it('sends the persona system prompt followed by the conversation history in order', async () => {
    const multiTurn = [
      { role: 'user' as const, content: 'What is the fastest car in the world?' },
      { role: 'assistant' as const, content: 'The current record holder, sir, is…' },
      { role: 'user' as const, content: 'What about the second fastest?' }
    ]
    const fetchMock = mockRoutedFetch({ choices: [{ message: { content: 'ok' } }] })
    await requestGroqReply(multiTurn)

    const body = chatCallBody(fetchMock)
    expect(body.messages[0].role).toBe('system')
    expect(body.messages[0].content).toContain(SYSTEM_PROMPT)
    // The full transcript follows the system message verbatim — this is what
    // makes follow-ups and pronoun references resolvable by the model.
    expect(body.messages.slice(1)).toEqual(multiTurn)
  })

  it('injects the awareness block into the system message', async () => {
    vi.stubEnv('JARVIS_LOCATION', '')
    vi.stubEnv('JARVIS_SCHEDULE_PATH', '/nonexistent/jarvis-schedule.json')
    const fetchMock = mockRoutedFetch({ choices: [{ message: { content: 'ok' } }] })
    await requestGroqReply([{ role: 'user', content: 'What time is it?' }])

    const system = chatCallBody(fetchMock).messages[0].content
    expect(system).toContain('# Awareness')
    expect(system).toMatch(/Current local date and time: \w+ \d+ \w+ \d{4}, \d{2}:\d{2}/)
    expect(system).toMatch(/System status \(read-only\): CPU \d+%/)
    expect(system).toContain('Work schedule: not configured')
    expect(system).toContain('Location: not configured')
  })

  it('injects the live weather feed into the system message', async () => {
    const fetchMock = mockRoutedFetch({ choices: [{ message: { content: 'ok' } }] })
    await requestGroqReply([{ role: 'user', content: "What's the weather in Trondheim?" }])

    const system = chatCallBody(fetchMock).messages[0].content
    expect(system).toContain('# Live weather feed')
    expect(system).toContain('Sistranda / Frøya: 12°C')
    expect(system).toContain('Trondheim: 10°C')
    expect(system).toContain('Light Rain')
    expect(system).toContain('from this data only')
  })

  it('injects an explicit unavailable note when the weather feed fails', async () => {
    const fetchMock = mockRoutedFetch({ choices: [{ message: { content: 'ok' } }] }, false)
    await requestGroqReply([{ role: 'user', content: 'Is it raining in Sistranda?' }])

    const system = chatCallBody(fetchMock).messages[0].content
    expect(system).toContain('temporarily unavailable')
    expect(system).toContain('do not guess, estimate, or invent')
    expect(system).not.toContain('°C),')
  })

  it('throws a config error when the key is missing, without calling fetch', async () => {
    vi.stubEnv('GROQ_API_KEY', '')
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    await expect(requestGroqReply(history)).rejects.toBeInstanceOf(GroqConfigError)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it.each([401, 403])('maps %i to a config error', async (status) => {
    mockFetchResponse(status, { error: 'denied' })
    await expect(requestGroqReply(history)).rejects.toBeInstanceOf(GroqConfigError)
  })

  it('maps 429 to a rate-limit request error', async () => {
    mockFetchResponse(429, { error: 'slow down' })
    await expect(requestGroqReply(history)).rejects.toThrow(/rate limit/i)
  })

  it('maps a 500 to a generic request error mentioning the status', async () => {
    mockFetchResponse(500, { error: 'boom' })
    await expect(requestGroqReply(history)).rejects.toThrow(/status 500/)
  })

  it('maps a 404 (e.g. unknown/decommissioned model) to a generic request error mentioning the status', async () => {
    mockFetchResponse(404, { error: { message: 'model_decommissioned' } })
    await expect(requestGroqReply(history)).rejects.toThrow(/status 404/)
  })

  it('rejects an empty completion as a request error', async () => {
    mockFetchResponse(200, { choices: [{ message: { content: '' } }] })
    await expect(requestGroqReply(history)).rejects.toBeInstanceOf(GroqRequestError)
  })

  it('maps a timeout abort to a timeout message', async () => {
    const abortError = new Error('aborted')
    abortError.name = 'TimeoutError'
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError))
    await expect(requestGroqReply(history)).rejects.toThrow(/timed out/i)
  })

  it('maps a network failure to a reachability message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
    await expect(requestGroqReply(history)).rejects.toThrow(/could not reach/i)
  })

  it('never includes the API key in thrown error messages', async () => {
    mockFetchResponse(500, { error: 'boom' })
    await expect(requestGroqReply(history)).rejects.toSatisfy(
      (err: Error) => !err.message.includes('test-key')
    )
  })
})

describe('token-efficiency contract (main 120b call)', () => {
  const chatOk = { choices: [{ message: { content: 'ok' } }] }
  const turn = (i: number): { role: 'user' | 'assistant'; content: string } => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `turn number ${i}`
  })

  it('keeps the compressed persona under the token budget', () => {
    // ~4 chars/token: 8,000 chars ≈ 2,000 tokens. Guard against re-bloat.
    expect(SYSTEM_PROMPT.length).toBeLessThan(8000)
  })

  it('sends only the most recent turns of a long conversation', async () => {
    const fetchMock = mockRoutedFetch(chatOk)
    const long = Array.from({ length: 30 }, (_, i) => turn(i))
    await requestGroqReply(long)
    const { messages } = chatCallBody(fetchMock)
    expect(messages).toHaveLength(1 + MAX_SENT_TURNS)
    expect(messages[1].content).toBe(`turn number ${30 - MAX_SENT_TURNS}`)
    expect(messages[messages.length - 1].content).toBe('turn number 29')
  })

  it('clips excessively long individual messages, marking the cut', () => {
    const trimmed = trimHistoryForPrompt([
      { role: 'user', content: 'x'.repeat(5000) },
      { role: 'user', content: 'short' }
    ])
    expect(trimmed[0].content.length).toBeLessThanOrEqual(MAX_SENT_MESSAGE_CHARS + 10)
    expect(trimmed[0].content.endsWith('[…]')).toBe(true)
    expect(trimmed[1].content).toBe('short')
  })

  it('caps output tokens and keeps gpt-oss reasoning short', async () => {
    const fetchMock = mockRoutedFetch(chatOk)
    await requestGroqReply(history)
    const body = chatCallBody(fetchMock) as unknown as Record<string, unknown>
    expect(body.max_tokens).toBe(640)
    expect(body.reasoning_effort).toBe('low')
  })

  it('omits reasoning_effort for non-gpt-oss model overrides', async () => {
    vi.stubEnv('GROQ_MODEL', 'some-other-model')
    const fetchMock = mockRoutedFetch(chatOk)
    await requestGroqReply(history)
    const body = chatCallBody(fetchMock) as unknown as Record<string, unknown>
    expect('reasoning_effort' in body).toBe(false)
  })
})

describe('429 handling', () => {
  const chatOk = { choices: [{ message: { content: 'recovered' } }] }

  function mock429Then(
    retryAfterSeconds: string | null,
    thenBody: unknown,
    thenStatus = 200
  ): ReturnType<typeof vi.fn> {
    let calls = 0
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('/forecast')) return Promise.reject(new TypeError('down'))
      calls += 1
      if (calls === 1) {
        return Promise.resolve({
          ok: false,
          status: 429,
          headers: { get: (h: string) => (h === 'retry-after' ? retryAfterSeconds : null) },
          text: () => Promise.resolve('rate limited')
        })
      }
      return Promise.resolve({
        ok: thenStatus >= 200 && thenStatus < 300,
        status: thenStatus,
        headers: { get: () => null },
        text: () => Promise.resolve(JSON.stringify(thenBody)),
        json: () => Promise.resolve(thenBody)
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  const chatCalls = (fetchMock: ReturnType<typeof vi.fn>): number =>
    fetchMock.mock.calls.filter((c) => String(c[0]).includes('/chat/completions')).length

  it('retries exactly once after a short Retry-After and succeeds', async () => {
    const fetchMock = mock429Then('1', chatOk)
    await expect(requestGroqReply(history)).resolves.toBe('recovered')
    expect(chatCalls(fetchMock)).toBe(2)
  })

  it('never retries a long Retry-After — quota exhaustion is reported honestly', async () => {
    const fetchMock = mock429Then('3600', chatOk)
    await expect(requestGroqReply(history)).rejects.toThrow(/rate limit/i)
    expect(chatCalls(fetchMock)).toBe(1)
  })

  it('gives up honestly after the single retry — no retry loops', async () => {
    let calls = 0
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('/forecast')) return Promise.reject(new TypeError('down'))
      calls += 1
      return Promise.resolve({
        ok: false,
        status: 429,
        headers: { get: (h: string) => (h === 'retry-after' ? '1' : null) },
        text: () => Promise.resolve('still limited')
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(requestGroqReply(history)).rejects.toThrow(/rate limit/i)
    expect(calls).toBe(2)
  })
})
