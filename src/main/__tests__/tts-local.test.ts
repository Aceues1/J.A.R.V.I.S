import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getTtsStatus, resolveTtsProvider, synthesizeSpeech } from '../tts'
import {
  localKokoroProvider,
  resetLocalTtsForTests,
  warmUpLocalTts,
  whenLocalTtsSettled
} from '../tts/local-kokoro'
import { resetGroqTtsModelCache } from '../tts/groq-playai'
import { TtsRequestError } from '../tts/types'

// Controllable stand-ins for the kokoro-js engine and the transformers env.
// The real model is never loaded in unit tests.
const kokoro = vi.hoisted(() => ({
  fromPretrained: vi.fn(),
  generate: vi.fn()
}))
const transformers = vi.hoisted(() => ({ env: {} as { cacheDir?: string } }))

vi.mock('kokoro-js', () => ({
  KokoroTTS: { from_pretrained: kokoro.fromPretrained }
}))
vi.mock('@huggingface/transformers', () => ({ env: transformers.env }))

function wavBytes(): ArrayBuffer {
  return new Uint8Array([82, 73, 70, 70, 9, 9, 9]).buffer // "RIFF" + payload
}

function readyEngine(): void {
  kokoro.generate.mockResolvedValue({ toWav: wavBytes })
  kokoro.fromPretrained.mockResolvedValue({ generate: kokoro.generate })
}

function mockCloudFetch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3]).slice().buffer),
    text: () => Promise.resolve('')
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  resetLocalTtsForTests()
  resetGroqTtsModelCache()
  kokoro.fromPretrained.mockReset()
  kokoro.generate.mockReset()
  delete transformers.env.cacheDir
  vi.stubEnv('LOCAL_TTS', 'on')
  vi.stubEnv('ELEVENLABS_API_KEY', '')
  vi.stubEnv('GROQ_API_KEY', '')
  vi.stubEnv('KOKORO_CACHE_DIR', '')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('local TTS provider selection', () => {
  it('is selected with LOCAL_TTS=on and requires no API key at all', () => {
    expect(resolveTtsProvider()?.name).toBe('local')
    expect(getTtsStatus()).toEqual({
      configured: true,
      provider: 'local',
      voice: 'kokoro/bm_george'
    })
  })

  it('outranks configured cloud providers', () => {
    vi.stubEnv('ELEVENLABS_API_KEY', 'el-key')
    vi.stubEnv('GROQ_API_KEY', 'groq-key')
    expect(resolveTtsProvider()?.name).toBe('local')
  })

  it('stays out of the chain entirely unless enabled', () => {
    vi.stubEnv('LOCAL_TTS', '')
    expect(getTtsStatus()).toEqual({ configured: false, provider: 'off', voice: '' })

    vi.stubEnv('LOCAL_TTS', 'off')
    vi.stubEnv('ELEVENLABS_API_KEY', 'el-key')
    expect(resolveTtsProvider()?.name).toBe('elevenlabs')
  })

  it('is pinnable via TTS_PROVIDER=local without the flag', () => {
    vi.stubEnv('LOCAL_TTS', '')
    vi.stubEnv('TTS_PROVIDER', 'local')
    expect(resolveTtsProvider()?.name).toBe('local')
    expect(localKokoroProvider.isConfigured()).toBe(true)
  })

  it('honors LOCAL_TTS_VOICE in the status label', () => {
    vi.stubEnv('LOCAL_TTS_VOICE', 'bm_lewis')
    expect(getTtsStatus().voice).toBe('kokoro/bm_lewis')
  })
})

describe('local synthesis success', () => {
  it('speaks locally after warm-up and never calls a cloud service', async () => {
    readyEngine()
    const fetchMock = mockCloudFetch()

    warmUpLocalTts()
    await whenLocalTtsSettled()

    const result = await synthesizeSpeech('Good evening, sir.')
    expect(result.mimeType).toBe('audio/wav')
    expect(Array.from(result.audio.slice(0, 4))).toEqual([82, 73, 70, 70])
    expect(kokoro.generate).toHaveBeenCalledWith('Good evening, sir.', { voice: 'bm_george' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('loads the model on the CPU with the q8 default', async () => {
    readyEngine()
    warmUpLocalTts()
    await whenLocalTtsSettled()
    expect(kokoro.fromPretrained).toHaveBeenCalledWith('onnx-community/Kokoro-82M-v1.0-ONNX', {
      dtype: 'q8',
      device: 'cpu'
    })
  })

  it('points the model cache at KOKORO_CACHE_DIR when set', async () => {
    readyEngine()
    vi.stubEnv('KOKORO_CACHE_DIR', '/custom/kokoro')
    warmUpLocalTts()
    await whenLocalTtsSettled()
    expect(transformers.env.cacheDir).toBe('/custom/kokoro')
  })

  it('warmUpLocalTts is a no-op when local TTS is disabled', () => {
    vi.stubEnv('LOCAL_TTS', 'off')
    warmUpLocalTts()
    expect(kokoro.fromPretrained).not.toHaveBeenCalled()
  })
})

describe('local failure falls back to the existing cloud chain', () => {
  it('falls back while the model is still loading (first-run download)', async () => {
    kokoro.fromPretrained.mockReturnValue(new Promise(() => {})) // never settles
    vi.stubEnv('GROQ_API_KEY', 'groq-key')
    const fetchMock = mockCloudFetch()

    const result = await synthesizeSpeech('Hello.')
    expect(result.mimeType).toBe('audio/mpeg')
    const speechCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/audio/speech'))
    expect(speechCall).toBeDefined()
    expect(JSON.parse(speechCall![1].body).input).toBe('Hello.')
  })

  it('falls back for the whole session when the model fails to load', async () => {
    kokoro.fromPretrained.mockRejectedValue(new Error('offline'))
    vi.stubEnv('GROQ_API_KEY', 'groq-key')
    const fetchMock = mockCloudFetch()

    warmUpLocalTts()
    await whenLocalTtsSettled()

    const result = await synthesizeSpeech('Hello.')
    expect(result.mimeType).toBe('audio/mpeg')
    expect(fetchMock).toHaveBeenCalled()
    // The dead engine is not retried on the next utterance.
    expect(kokoro.fromPretrained).toHaveBeenCalledTimes(1)
  })

  it('falls back for a single utterance when one generation fails, then recovers', async () => {
    readyEngine()
    kokoro.generate
      .mockRejectedValueOnce(new Error('onnx hiccup'))
      .mockResolvedValueOnce({ toWav: wavBytes })
    vi.stubEnv('GROQ_API_KEY', 'groq-key')
    const fetchMock = mockCloudFetch()

    warmUpLocalTts()
    await whenLocalTtsSettled()

    const first = await synthesizeSpeech('One.')
    expect(first.mimeType).toBe('audio/mpeg') // cloud fallback for this utterance

    const second = await synthesizeSpeech('Two.')
    expect(second.mimeType).toBe('audio/wav') // local voice recovered
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes('/audio/speech'))).toHaveLength(
      1
    )
  })

  it('reports an honest error when local fails and no cloud provider exists', async () => {
    kokoro.fromPretrained.mockRejectedValue(new Error('offline'))
    warmUpLocalTts()
    await whenLocalTtsSettled()
    await expect(synthesizeSpeech('Hello.')).rejects.toBeInstanceOf(TtsRequestError)
  })

  it('rejects empty local audio instead of playing silence', async () => {
    kokoro.generate.mockResolvedValue({ toWav: () => new ArrayBuffer(0) })
    kokoro.fromPretrained.mockResolvedValue({ generate: kokoro.generate })
    warmUpLocalTts()
    await whenLocalTtsSettled()
    await expect(localKokoroProvider.synthesize('Hi.')).rejects.toBeInstanceOf(TtsRequestError)
  })
})
