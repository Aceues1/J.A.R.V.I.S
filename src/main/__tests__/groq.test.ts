import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GroqConfigError, GroqRequestError, getGroqStatus, requestGroqReply } from '../groq'

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
