import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_SPEAK_TEXT_LENGTH,
  TtsConfigError,
  getTtsStatus,
  resolveTtsProvider,
  synthesizeSpeech,
  validateSpeakPayload
} from '../tts'

function mockFetchAudio(
  status: number,
  bytes = new Uint8Array([1, 2, 3])
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: () => Promise.resolve(bytes.slice().buffer),
    text: () => Promise.resolve('{"error":"details"}')
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('validateSpeakPayload', () => {
  it('accepts and trims a plain text payload', () => {
    expect(validateSpeakPayload({ text: '  Hello there.  ' })).toBe('Hello there.')
  })

  it.each([
    ['non-object', 'nope'],
    ['missing text', {}],
    ['non-string text', { text: 42 }],
    ['blank text', { text: '   ' }]
  ])('rejects %s', (_label, bad) => {
    expect(validateSpeakPayload(bad)).toBeNull()
  })

  it('truncates overly long text to the speech cap', () => {
    const result = validateSpeakPayload({ text: 'a'.repeat(MAX_SPEAK_TEXT_LENGTH + 500) })
    expect(result?.length).toBe(MAX_SPEAK_TEXT_LENGTH)
  })
})

describe('provider selection', () => {
  it('prefers ElevenLabs when its key is configured', () => {
    vi.stubEnv('ELEVENLABS_API_KEY', 'el-key')
    vi.stubEnv('GROQ_API_KEY', 'groq-key')
    expect(resolveTtsProvider()?.name).toBe('elevenlabs')
    expect(getTtsStatus()).toMatchObject({ configured: true, provider: 'elevenlabs' })
  })

  it('falls back to Groq PlayAI on the existing Groq key', () => {
    vi.stubEnv('ELEVENLABS_API_KEY', '')
    vi.stubEnv('GROQ_API_KEY', 'groq-key')
    expect(resolveTtsProvider()?.name).toBe('groq')
    expect(getTtsStatus()).toMatchObject({ configured: true, provider: 'groq' })
  })

  it('honors an explicit TTS_PROVIDER even when a better one is configured', () => {
    vi.stubEnv('ELEVENLABS_API_KEY', 'el-key')
    vi.stubEnv('GROQ_API_KEY', 'groq-key')
    vi.stubEnv('TTS_PROVIDER', 'groq')
    expect(resolveTtsProvider()?.name).toBe('groq')
  })

  it('reports off when disabled or nothing is configured', () => {
    vi.stubEnv('ELEVENLABS_API_KEY', '')
    vi.stubEnv('GROQ_API_KEY', '')
    expect(getTtsStatus()).toEqual({ configured: false, provider: 'off', voice: '' })

    vi.stubEnv('GROQ_API_KEY', 'groq-key')
    vi.stubEnv('TTS_PROVIDER', 'off')
    expect(getTtsStatus()).toEqual({ configured: false, provider: 'off', voice: '' })
  })
})

describe('synthesizeSpeech via ElevenLabs', () => {
  beforeEach(() => {
    vi.stubEnv('ELEVENLABS_API_KEY', 'el-test-key')
    vi.stubEnv('GROQ_API_KEY', '')
  })

  it('posts to the voice endpoint with the key in a header, never the URL', async () => {
    const fetchMock = mockFetchAudio(200)
    const result = await synthesizeSpeech('Hello.')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('https://api.elevenlabs.io/v1/text-to-speech/')
    expect(url).not.toContain('el-test-key')
    expect(init.headers['xi-api-key']).toBe('el-test-key')
    expect(JSON.parse(init.body)).toMatchObject({
      text: 'Hello.',
      model_id: 'eleven_multilingual_v2'
    })
    expect(result.mimeType).toBe('audio/mpeg')
    expect(result.audio).toBeInstanceOf(Uint8Array)
    expect(result.audio.byteLength).toBe(3)
  })

  it('honors ELEVENLABS_VOICE_ID and ELEVENLABS_BASE_URL overrides', async () => {
    vi.stubEnv('ELEVENLABS_VOICE_ID', 'custom-voice')
    vi.stubEnv('ELEVENLABS_BASE_URL', 'http://localhost:8888')
    const fetchMock = mockFetchAudio(200)
    await synthesizeSpeech('Hi')
    expect(fetchMock.mock.calls[0][0]).toContain(
      'http://localhost:8888/text-to-speech/custom-voice'
    )
  })

  it.each([401, 403])('maps %i to a config error', async (status) => {
    mockFetchAudio(status)
    await expect(synthesizeSpeech('Hi')).rejects.toBeInstanceOf(TtsConfigError)
  })

  it('maps 429 to a rate-limit error', async () => {
    mockFetchAudio(429)
    await expect(synthesizeSpeech('Hi')).rejects.toThrow(/rate limit/i)
  })

  it('maps a 500 to a generic error mentioning the status', async () => {
    mockFetchAudio(500)
    await expect(synthesizeSpeech('Hi')).rejects.toThrow(/status 500/)
  })

  it('rejects empty audio', async () => {
    mockFetchAudio(200, new Uint8Array(0))
    await expect(synthesizeSpeech('Hi')).rejects.toThrow(/empty audio/i)
  })

  it('maps a timeout to a timeout error', async () => {
    const abortError = new Error('aborted')
    abortError.name = 'TimeoutError'
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError))
    await expect(synthesizeSpeech('Hi')).rejects.toThrow(/timed out/i)
  })

  it('maps a network failure to a reachability error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
    await expect(synthesizeSpeech('Hi')).rejects.toThrow(/could not reach/i)
  })

  it('never includes the API key in thrown error messages', async () => {
    mockFetchAudio(500)
    await expect(synthesizeSpeech('Hi')).rejects.toSatisfy(
      (err: Error) => !err.message.includes('el-test-key')
    )
  })
})

describe('synthesizeSpeech via Groq PlayAI', () => {
  beforeEach(() => {
    vi.stubEnv('ELEVENLABS_API_KEY', '')
    vi.stubEnv('GROQ_API_KEY', 'groq-test-key')
  })

  it('posts model, voice and input to the audio/speech endpoint', async () => {
    const fetchMock = mockFetchAudio(200)
    const result = await synthesizeSpeech('Hello.')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.groq.com/openai/v1/audio/speech')
    expect(init.headers.Authorization).toBe('Bearer groq-test-key')
    expect(JSON.parse(init.body)).toMatchObject({
      model: 'playai-tts',
      voice: 'Basil-PlayAI',
      input: 'Hello.',
      response_format: 'mp3'
    })
    expect(result.mimeType).toBe('audio/mpeg')
  })

  it('honors GROQ_TTS_VOICE and GROQ_BASE_URL overrides', async () => {
    vi.stubEnv('GROQ_TTS_VOICE', 'Celeste-PlayAI')
    vi.stubEnv('GROQ_BASE_URL', 'http://localhost:7777')
    const fetchMock = mockFetchAudio(200)
    await synthesizeSpeech('Hi')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:7777/audio/speech')
    expect(JSON.parse(init.body).voice).toBe('Celeste-PlayAI')
  })

  it('throws a config error without calling fetch when nothing is configured', async () => {
    vi.stubEnv('GROQ_API_KEY', '')
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    await expect(synthesizeSpeech('Hi')).rejects.toBeInstanceOf(TtsConfigError)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
