import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GroqConfigError, GroqRequestError } from '../groq'
import { MAX_AUDIO_BYTES, transcribeAudio, validateAudioPayload } from '../transcription'

const payload = { audio: new Uint8Array([1, 2, 3]), mimeType: 'audio/webm' }

function mockFetchResponse(status: number, body: unknown): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
    json: () =>
      typeof body === 'string' ? Promise.reject(new Error('not json')) : Promise.resolve(body)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  vi.stubEnv('GROQ_API_KEY', 'test-key')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('validateAudioPayload', () => {
  it('accepts a Uint8Array with a known mime type', () => {
    expect(validateAudioPayload(payload)).toEqual(payload)
  })

  it('accepts an ArrayBuffer and normalizes it to Uint8Array', () => {
    const result = validateAudioPayload({
      audio: new Uint8Array([9]).buffer,
      mimeType: 'audio/webm'
    })
    expect(result?.audio).toBeInstanceOf(Uint8Array)
    expect(result?.audio.byteLength).toBe(1)
  })

  it('strips codec parameters from the mime type', () => {
    const result = validateAudioPayload({
      audio: new Uint8Array([1]),
      mimeType: 'audio/webm;codecs=opus'
    })
    expect(result?.mimeType).toBe('audio/webm')
  })

  it.each([
    ['non-object payload', 'nope'],
    ['missing audio', { mimeType: 'audio/webm' }],
    ['audio of wrong type', { audio: [1, 2, 3], mimeType: 'audio/webm' }],
    ['missing mime type', { audio: new Uint8Array([1]) }],
    ['unknown mime type', { audio: new Uint8Array([1]), mimeType: 'video/mp4' }],
    ['empty audio', { audio: new Uint8Array(0), mimeType: 'audio/webm' }]
  ])('rejects %s', (_label, bad) => {
    expect(validateAudioPayload(bad)).toBeNull()
  })

  it('rejects audio above the size cap', () => {
    const oversized = { audio: new Uint8Array(MAX_AUDIO_BYTES + 1), mimeType: 'audio/webm' }
    expect(validateAudioPayload(oversized)).toBeNull()
  })
})

describe('transcribeAudio', () => {
  it('returns the trimmed transcript on success', async () => {
    mockFetchResponse(200, { text: '  Hello JARVIS.  ' })
    await expect(transcribeAudio(payload)).resolves.toBe('Hello JARVIS.')
  })

  it('posts multipart form data to the transcriptions endpoint with the default model', async () => {
    const fetchMock = mockFetchResponse(200, { text: 'hi' })
    await transcribeAudio(payload)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.groq.com/openai/v1/audio/transcriptions')
    expect(init.body).toBeInstanceOf(FormData)
    expect(init.body.get('model')).toBe('whisper-large-v3-turbo')
    expect(init.headers.Authorization).toBe('Bearer test-key')
  })

  it('honors GROQ_STT_MODEL and GROQ_BASE_URL overrides', async () => {
    vi.stubEnv('GROQ_STT_MODEL', 'custom-stt')
    vi.stubEnv('GROQ_BASE_URL', 'http://localhost:9999')
    const fetchMock = mockFetchResponse(200, { text: 'hi' })
    await transcribeAudio(payload)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:9999/audio/transcriptions')
    expect(init.body.get('model')).toBe('custom-stt')
  })

  it('throws a config error when the key is missing, without calling fetch', async () => {
    vi.stubEnv('GROQ_API_KEY', '')
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    await expect(transcribeAudio(payload)).rejects.toBeInstanceOf(GroqConfigError)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it.each([401, 403])('maps %i to a config error', async (status) => {
    mockFetchResponse(status, { error: 'denied' })
    await expect(transcribeAudio(payload)).rejects.toBeInstanceOf(GroqConfigError)
  })

  it('maps 413 to a too-large message', async () => {
    mockFetchResponse(413, { error: 'too big' })
    await expect(transcribeAudio(payload)).rejects.toThrow(/too large/i)
  })

  it('maps 429 to a rate-limit request error', async () => {
    mockFetchResponse(429, { error: 'slow down' })
    await expect(transcribeAudio(payload)).rejects.toThrow(/rate limit/i)
  })

  it('maps a 500 to a generic request error mentioning the status', async () => {
    mockFetchResponse(500, { error: 'boom' })
    await expect(transcribeAudio(payload)).rejects.toThrow(/status 500/)
  })

  it('rejects an empty transcript with a no-speech message', async () => {
    mockFetchResponse(200, { text: '   ' })
    await expect(transcribeAudio(payload)).rejects.toThrow(/no speech detected/i)
  })

  it('rejects a malformed response shape', async () => {
    mockFetchResponse(200, { unexpected: true })
    await expect(transcribeAudio(payload)).rejects.toBeInstanceOf(GroqRequestError)
  })

  it('maps a timeout abort to a timeout message', async () => {
    const abortError = new Error('aborted')
    abortError.name = 'TimeoutError'
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError))
    await expect(transcribeAudio(payload)).rejects.toThrow(/timed out/i)
  })

  it('maps a network failure to a reachability message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
    await expect(transcribeAudio(payload)).rejects.toThrow(/could not reach/i)
  })

  it('never includes the API key in thrown error messages', async () => {
    mockFetchResponse(500, { error: 'boom' })
    await expect(transcribeAudio(payload)).rejects.toSatisfy(
      (err: Error) => !err.message.includes('test-key')
    )
  })
})
