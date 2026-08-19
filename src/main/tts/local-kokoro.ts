import { TtsConfigError, TtsRequestError, type TtsAudio, type TtsProvider } from './types'

// Local Kokoro-82M text-to-speech — runs entirely on this machine via the
// kokoro-js ONNX runtime, pinned to the CPU so the GPU stays free for games.
// No API key, no credits, works offline once the model is cached.
//
// Opt-in: enabled only when LOCAL_TTS is on (or TTS_PROVIDER=local), so the
// cloud-only behavior is untouched for anyone without the flag.
//
// The model loads lazily in the background (warmUpLocalTts at app start).
// Synthesis never waits for a load in progress — while the model is loading
// (including the one-time ~92MB download on first use) the registry falls
// back to the cloud chain, and once ready all speech stays local. A load
// failure marks the provider dead for the session with a clear log; a single
// failed generation only falls back for that utterance.
const DEFAULT_MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX'
// British male voice in the same register as the ElevenLabs Daniel default.
// Other British options: bm_lewis, bm_daniel, bm_fable.
const DEFAULT_VOICE = 'bm_george'
// q8 keeps the download ~92MB and CPU synthesis fast with near-fp32 quality.
const DEFAULT_DTYPE = 'q8'
const GENERATION_TIMEOUT_MS = 45_000

interface KokoroAudio {
  toWav(): ArrayBuffer
}

interface KokoroEngine {
  generate(text: string, options: { voice: string; speed?: number }): Promise<KokoroAudio>
}

type LoadState = 'idle' | 'loading' | 'ready' | 'dead'

let state: LoadState = 'idle'
let engine: KokoroEngine | null = null
let loadPromise: Promise<void> | null = null

/** Test hook: forget the engine and load state. */
export function resetLocalTtsForTests(): void {
  state = 'idle'
  engine = null
  loadPromise = null
}

/** Test hook: await the in-flight load (resolves immediately when none). */
export function whenLocalTtsSettled(): Promise<void> {
  return loadPromise ?? Promise.resolve()
}

function isEnabled(): boolean {
  const flag = (process.env.LOCAL_TTS || '').trim().toLowerCase()
  if (['off', '0', 'false', 'no'].includes(flag)) return false
  if (['on', '1', 'true', 'yes'].includes(flag)) return true
  return (process.env.TTS_PROVIDER || '').trim().toLowerCase() === 'local'
}

function getVoice(): string {
  return process.env.LOCAL_TTS_VOICE || DEFAULT_VOICE
}

// Model cache location: KOKORO_CACHE_DIR wins; otherwise the Electron
// userData folder (survives node_modules wipes); otherwise the transformers.js
// default (node_modules/@huggingface/transformers/.cache).
async function resolveCacheDir(): Promise<string | null> {
  if (process.env.KOKORO_CACHE_DIR) return process.env.KOKORO_CACHE_DIR
  try {
    const { app } = await import('electron')
    if (app?.getPath) {
      const { join } = await import('path')
      return join(app.getPath('userData'), 'kokoro-cache')
    }
  } catch {
    // Not running under Electron (unit tests) — keep the library default.
  }
  return null
}

async function loadEngine(): Promise<void> {
  const modelId = process.env.LOCAL_TTS_MODEL || DEFAULT_MODEL_ID
  const dtype = process.env.LOCAL_TTS_DTYPE || DEFAULT_DTYPE
  const cacheDir = await resolveCacheDir()
  if (cacheDir) {
    // kokoro-js resolves models through @huggingface/transformers; pointing
    // its cache at userData keeps the one-time download out of node_modules.
    const transformers = await import('@huggingface/transformers')
    transformers.env.cacheDir = cacheDir
  }
  const { KokoroTTS } = await import('kokoro-js')
  console.log(`[tts:local] loading Kokoro model ${modelId} (${dtype}, cpu)`)
  engine = (await KokoroTTS.from_pretrained(modelId, {
    dtype: dtype as 'fp32' | 'fp16' | 'q8' | 'q4' | 'q4f16',
    device: 'cpu'
  })) as unknown as KokoroEngine
  console.log(`[tts:local] Kokoro ready — voice ${getVoice()}, CPU only, no cloud calls`)
}

function startLoad(): void {
  if (state !== 'idle') return
  state = 'loading'
  loadPromise = loadEngine()
    .then(() => {
      state = 'ready'
    })
    .catch((error) => {
      state = 'dead'
      engine = null
      console.error(
        '[tts:local] Kokoro failed to load — local voice off for this session, ' +
          'falling back to cloud TTS. First-time setup needs internet once for the ' +
          'model download.',
        error instanceof Error ? error.message : error
      )
    })
}

/**
 * Kick off the background model load at app start so the voice is usually
 * ready before the first reply. Never blocks; no-op unless LOCAL_TTS is on.
 */
export function warmUpLocalTts(): void {
  if (isEnabled()) startLoad()
}

export const localKokoroProvider: TtsProvider = {
  name: 'local',

  voiceLabel(): string {
    return `kokoro/${getVoice()}`
  },

  isConfigured(): boolean {
    return isEnabled()
  },

  async synthesize(text: string): Promise<TtsAudio> {
    if (!isEnabled()) {
      throw new TtsConfigError('Local TTS is not enabled. Set LOCAL_TTS=on to use it.')
    }
    if (state === 'dead') {
      throw new TtsRequestError('Local voice is unavailable this session.')
    }
    if (state === 'idle') startLoad()
    if (state !== 'ready' || !engine) {
      throw new TtsRequestError('Local voice model is still loading.')
    }

    let audio: KokoroAudio
    try {
      let timer: NodeJS.Timeout | undefined
      // ONNX inference has no abort signal; the watchdog only bounds how long
      // speech playback waits — a hung generation is abandoned, not killed.
      const watchdog = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new TtsRequestError('Local voice synthesis timed out.')),
          GENERATION_TIMEOUT_MS
        )
      })
      try {
        audio = await Promise.race([engine.generate(text, { voice: getVoice() }), watchdog])
      } finally {
        clearTimeout(timer)
      }
    } catch (error) {
      if (error instanceof TtsRequestError) throw error
      console.error('[tts:local] synthesis failed', error)
      throw new TtsRequestError('Local voice synthesis failed.')
    }

    const wav = new Uint8Array(audio.toWav())
    if (wav.byteLength === 0) {
      throw new TtsRequestError('Local voice produced empty audio.')
    }
    return { audio: wav, mimeType: 'audio/wav' }
  }
}
