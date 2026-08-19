import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GroqConfigError, requestGroqReply, resetRateLedger } from '../groq'
import {
  isCoolingDown,
  providerChain,
  resetProviderCooldowns,
  setProviderCooldownUntilForTests
} from '../providers'
import { resetWeatherCache } from '../weather'

// Distinct fake base URLs so the fetch mock can tell providers apart.
const GROQ = 'http://groq.test'
const OR = 'http://or.test'
const GEM = 'http://gem.test'

interface FakeResponse {
  ok: boolean
  status: number
  headers: { get: (name: string) => string | null }
  text: () => Promise<string>
  json: () => Promise<unknown>
}

function reply(content: string): FakeResponse {
  const body = { choices: [{ message: { content } }] }
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body)
  }
}

function failure(status: number, retryAfter?: string): FakeResponse {
  return {
    ok: false,
    status,
    headers: { get: (name) => (name === 'retry-after' ? (retryAfter ?? null) : null) },
    text: () => Promise.resolve('{"error":"details"}'),
    json: () => Promise.resolve({ error: 'details' })
  }
}

const weatherBody = [
  {
    current: {
      temperature_2m: 12,
      apparent_temperature: 10,
      weather_code: 3,
      wind_speed_10m: 5
    },
    daily: { temperature_2m_max: [14], temperature_2m_min: [9] }
  },
  {
    current: {
      temperature_2m: 11,
      apparent_temperature: 9,
      weather_code: 61,
      wind_speed_10m: 4
    },
    daily: { temperature_2m_max: [13], temperature_2m_min: [8] }
  }
]

/**
 * Install a fetch mock with per-provider response queues (last entry repeats)
 * and capture each provider's chat request bodies.
 */
function installFetch(queues: {
  groq?: FakeResponse[]
  or?: FakeResponse[]
  gem?: FakeResponse[]
}): {
  bodies: { groq: string[]; or: string[]; gem: string[] }
  headers: {
    groq: Array<Record<string, string>>
    or: Array<Record<string, string>>
    gem: Array<Record<string, string>>
  }
  fetchMock: ReturnType<typeof vi.fn>
} {
  const bodies = { groq: [] as string[], or: [] as string[], gem: [] as string[] }
  const headers = {
    groq: [] as Array<Record<string, string>>,
    or: [] as Array<Record<string, string>>,
    gem: [] as Array<Record<string, string>>
  }
  const next = (queue?: FakeResponse[]): FakeResponse =>
    queue && queue.length > 1 ? queue.shift()! : (queue?.[0] ?? reply('unexpected'))
  const fetchMock = vi
    .fn()
    .mockImplementation(
      (url: string, init?: { body?: string; headers?: Record<string, string> }) => {
        const target = String(url)
        if (target.includes('/forecast')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: { get: () => null },
            text: () => Promise.resolve(JSON.stringify(weatherBody)),
            json: () => Promise.resolve(weatherBody)
          })
        }
        if (target.startsWith(GROQ)) {
          bodies.groq.push(init?.body ?? '')
          headers.groq.push(init?.headers ?? {})
          return Promise.resolve(next(queues.groq))
        }
        if (target.startsWith(OR)) {
          bodies.or.push(init?.body ?? '')
          headers.or.push(init?.headers ?? {})
          return Promise.resolve(next(queues.or))
        }
        if (target.startsWith(GEM)) {
          bodies.gem.push(init?.body ?? '')
          headers.gem.push(init?.headers ?? {})
          return Promise.resolve(next(queues.gem))
        }
        throw new Error(`unexpected fetch to ${target}`)
      }
    )
  vi.stubGlobal('fetch', fetchMock)
  return { bodies, headers, fetchMock }
}

const QUOTA_429 = (): FakeResponse => failure(429, '86400')
const history = [{ role: 'user' as const, content: 'hello' }]

beforeEach(() => {
  vi.stubEnv('GROQ_API_KEY', 'groq-secret-key')
  vi.stubEnv('GROQ_BASE_URL', GROQ)
  vi.stubEnv('OPENROUTER_API_KEY', 'or-secret-key')
  vi.stubEnv('OPENROUTER_BASE_URL', OR)
  vi.stubEnv('GEMINI_API_KEY', 'gem-secret-key')
  vi.stubEnv('GEMINI_BASE_URL', GEM)
  resetWeatherCache()
  resetRateLedger()
  resetProviderCooldowns()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('provider chain composition', () => {
  it('orders groq → openrouter → gemini and skips unkeyed tiers', () => {
    expect(providerChain().map((p) => p.name)).toEqual(['groq', 'openrouter', 'gemini'])
    vi.stubEnv('OPENROUTER_API_KEY', '')
    expect(providerChain().map((p) => p.name)).toEqual(['groq', 'gemini'])
    vi.stubEnv('GEMINI_API_KEY', '')
    expect(providerChain().map((p) => p.name)).toEqual(['groq'])
  })

  it('uses the documented free-tier default models', () => {
    const [groq, or, gem] = providerChain()
    expect(groq.model()).toBe('openai/gpt-oss-120b')
    // openrouter/free is OpenRouter's rotating router over currently-live
    // free models — individual ":free" slugs get delisted without notice.
    expect(or.model()).toBe('openrouter/free')
    expect(gem.model()).toBe('gemini-flash-latest')
  })

  it('honors an OPENROUTER_MODEL pin', () => {
    vi.stubEnv('OPENROUTER_MODEL', 'some-vendor/some-model:free')
    expect(providerChain()[1].model()).toBe('some-vendor/some-model:free')
  })
})

describe('failover on Groq quota exhaustion', () => {
  it('fails over to OpenRouter within the same turn and sets a cooldown', async () => {
    const { bodies } = installFetch({ groq: [QUOTA_429()], or: [reply('Via OpenRouter, sir.')] })

    await expect(requestGroqReply(history)).resolves.toBe('Via OpenRouter, sir.')
    expect(bodies.groq).toHaveLength(1)
    expect(bodies.or).toHaveLength(1)
    expect(isCoolingDown('groq')).toBe(true)

    // Next turn: the cooling provider is skipped, not re-hammered.
    await expect(requestGroqReply(history)).resolves.toBe('Via OpenRouter, sir.')
    expect(bodies.groq).toHaveLength(1)
    expect(bodies.or).toHaveLength(2)
  })

  it('keeps the short-window 429 retry on Groq without failing over', async () => {
    const { bodies } = installFetch({
      groq: [failure(429, '1'), reply('Recovered on Groq.')],
      or: [reply('should not be used')]
    })
    await expect(requestGroqReply(history)).resolves.toBe('Recovered on Groq.')
    expect(bodies.groq).toHaveLength(2)
    expect(bodies.or).toHaveLength(0)
    expect(isCoolingDown('groq')).toBe(false)
  })

  it('passes an action envelope through the fallback provider unchanged', async () => {
    const envelope = '{"action":"play_music","target":"Bohemian Rhapsody by Queen"}'
    installFetch({ groq: [QUOTA_429()], or: [reply(envelope)] })
    await expect(requestGroqReply(history)).resolves.toBe(envelope)
  })
})

describe('transient failures fail over without cooldown', () => {
  it.each([
    ['500', (): FakeResponse => failure(500)],
    ['401', (): FakeResponse => failure(401)],
    ['empty content', (): FakeResponse => reply('')]
  ])('groq %s → OpenRouter serves, groq retried next turn', async (_label, make) => {
    const { bodies } = installFetch({ groq: [make()], or: [reply('Fallback, sir.')] })
    await expect(requestGroqReply(history)).resolves.toBe('Fallback, sir.')
    expect(isCoolingDown('groq')).toBe(false)

    await requestGroqReply(history)
    expect(bodies.groq).toHaveLength(2) // probed again — no cooldown for transients
  })

  it('two short-window 429s fail over this turn but leave groq available', async () => {
    const { bodies } = installFetch({
      groq: [failure(429, '1'), failure(429, '1'), reply('Groq again.')],
      or: [reply('Fallback, sir.')]
    })
    await expect(requestGroqReply(history)).resolves.toBe('Fallback, sir.')
    expect(bodies.groq).toHaveLength(2)
    expect(isCoolingDown('groq')).toBe(false)
    await expect(requestGroqReply(history)).resolves.toBe('Groq again.')
  })
})

describe('Gemini fallback privacy and request shape', () => {
  const MEMORY_BLOCK = 'Stored context about the user MEMORY-SECRET-teal'
  const SEARCH_BLOCK = '# Live web search results SEARCH-BLOCK-headlines'

  it('withholds the memory block from Gemini but keeps search context', async () => {
    const { bodies } = installFetch({
      groq: [QUOTA_429()],
      or: [QUOTA_429()],
      gem: [reply('Via Gemini, sir.')]
    })
    await expect(requestGroqReply(history, SEARCH_BLOCK, MEMORY_BLOCK)).resolves.toBe(
      'Via Gemini, sir.'
    )
    // Groq and OpenRouter received the full context, in the usual order.
    for (const body of [bodies.groq[0], bodies.or[0]]) {
      const system = (JSON.parse(body).messages as Array<{ content: string }>)[0].content
      expect(system).toContain('MEMORY-SECRET-teal')
      expect(system).toContain('SEARCH-BLOCK-headlines')
      expect(system.indexOf('MEMORY-SECRET-teal')).toBeLessThan(
        system.indexOf('SEARCH-BLOCK-headlines')
      )
    }
    // Gemini got persona + search, but never the memory block.
    const gemBody = JSON.parse(bodies.gem[0])
    const gemSystem = (gemBody.messages as Array<{ content: string }>)[0].content
    expect(gemSystem).not.toContain('MEMORY-SECRET-teal')
    expect(gemSystem).toContain('SEARCH-BLOCK-headlines')
    // And no gpt-oss-specific knobs on the compat endpoint.
    expect(gemBody.model).toBe('gemini-flash-latest')
    expect(gemBody).not.toHaveProperty('reasoning_effort')
    // The gpt-oss reasoning knob rides only with gpt-oss models: groq yes,
    // the openrouter/free router (unknown model family) no.
    expect(JSON.parse(bodies.groq[0])).toHaveProperty('reasoning_effort', 'low')
    expect(JSON.parse(bodies.or[0])).not.toHaveProperty('reasoning_effort')
  })
})

describe('per-provider authentication', () => {
  it('authenticates Gemini with x-goog-api-key and never a Bearer header', async () => {
    const { headers } = installFetch({
      groq: [QUOTA_429()],
      or: [QUOTA_429()],
      gem: [reply('Via Gemini, sir.')]
    })
    await expect(requestGroqReply(history)).resolves.toBe('Via Gemini, sir.')
    expect(headers.gem[0]['x-goog-api-key']).toBe('gem-secret-key')
    expect(headers.gem[0]).not.toHaveProperty('Authorization')
    // Groq and OpenRouter keep standard Bearer auth (and no Google header).
    expect(headers.groq[0]['Authorization']).toBe('Bearer groq-secret-key')
    expect(headers.groq[0]).not.toHaveProperty('x-goog-api-key')
    expect(headers.or[0]['Authorization']).toBe('Bearer or-secret-key')
    expect(headers.or[0]).not.toHaveProperty('x-goog-api-key')
  })
})

describe('OpenRouter delisted-model 404', () => {
  const model404 = (): FakeResponse => ({
    ok: false,
    status: 404,
    headers: { get: () => null },
    text: () =>
      Promise.resolve(
        '{"error":{"message":"This model is unavailable for free. The paid version is ' +
          'available now - use this slug instead: openai/gpt-oss-120b","code":404}}'
      ),
    json: () => Promise.resolve({})
  })

  it('cools the provider down instead of hammering it every turn', async () => {
    const { bodies } = installFetch({
      groq: [QUOTA_429()],
      or: [model404()],
      gem: [reply('Via Gemini, sir.')]
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(requestGroqReply(history)).resolves.toBe('Via Gemini, sir.')
    expect(isCoolingDown('openrouter')).toBe(true)

    // Next turn: the dead-model provider is skipped entirely.
    await expect(requestGroqReply(history)).resolves.toBe('Via Gemini, sir.')
    expect(bodies.or).toHaveLength(1)
    // The log advises the override knob, naming no secrets.
    const logged = errorSpy.mock.calls.flat().map(String).join('\n')
    expect(logged).toContain('Set OPENROUTER_MODEL to a current model')
    expect(logged).not.toContain('or-secret-key')
  })
})

describe('all providers unavailable', () => {
  it('surfaces the honest rate-limit error and stops calling exhausted tiers', async () => {
    const { bodies } = installFetch({
      groq: [QUOTA_429()],
      or: [QUOTA_429()],
      gem: [QUOTA_429()]
    })
    await expect(requestGroqReply(history)).rejects.toThrow(/rate limit/i)
    const totalCalls = (): number => bodies.groq.length + bodies.or.length + bodies.gem.length
    expect(totalCalls()).toBe(3)

    // Every tier is cooling: no further requests, still an honest error.
    await expect(requestGroqReply(history)).rejects.toThrow(/rate limit/i)
    expect(totalCalls()).toBe(3)
  })

  it('throws the original config error when nothing at all is configured', async () => {
    vi.stubEnv('GROQ_API_KEY', '')
    vi.stubEnv('OPENROUTER_API_KEY', '')
    vi.stubEnv('GEMINI_API_KEY', '')
    await expect(requestGroqReply(history)).rejects.toBeInstanceOf(GroqConfigError)
  })
})

describe('automatic recovery', () => {
  it('probes Groq again once its cooldown lapses — no restart needed', async () => {
    const { bodies } = installFetch({
      groq: [QUOTA_429(), reply('Groq is back, sir.')],
      or: [reply('Via OpenRouter, sir.')]
    })
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await expect(requestGroqReply(history)).resolves.toBe('Via OpenRouter, sir.')
    expect(isCoolingDown('groq')).toBe(true)

    setProviderCooldownUntilForTests('groq', Date.now() - 1)
    await expect(requestGroqReply(history)).resolves.toBe('Groq is back, sir.')
    expect(bodies.groq).toHaveLength(2)
    expect(logSpy.mock.calls.map((c) => String(c[0]))).toContain(
      '[ai] groq recovered — back in service'
    )
  })
})

describe('secrets never leak', () => {
  it('keeps API keys out of every log line and error message', async () => {
    installFetch({ groq: [QUOTA_429()], or: [QUOTA_429()], gem: [QUOTA_429()] })
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const thrown = await requestGroqReply(history).then(
      () => null,
      (error: Error) => error
    )

    const logged = [...logSpy.mock.calls, ...errorSpy.mock.calls]
      .flat()
      .map((value) => String(value))
      .join('\n')
    for (const secret of ['groq-secret-key', 'or-secret-key', 'gem-secret-key']) {
      expect(logged).not.toContain(secret)
      expect(String(thrown?.message)).not.toContain(secret)
    }
    // Failover logging names providers only.
    expect(logged).toContain(
      '[ai] groq exhausted (retry-after 86400s) — failing over to openrouter'
    )
  })
})
