import { TtsConfigError, TtsRequestError, type TtsAudio, type TtsProvider } from './types'

// Groq text-to-speech on the existing GROQ_API_KEY — the zero-extra-config
// fallback provider (ElevenLabs stays preferred when its key exists).
//
// Groq has decommissioned TTS models before (`playai-tts` died in 2026 with a
// 400 "has been decommissioned"), so the model id is SELF-HEALING: the
// preferred model is tried first, and when Groq rejects it as dead, the live
// model list is fetched from Groq's own /models endpoint and the first
// TTS-capable model is used instead — cached for the session. GROQ_TTS_MODEL
// pins a model explicitly and always wins. If the account has no TTS model at
// all, voice output degrades to text-only with a clear log; chat never breaks.
const DEFAULT_BASE_URL = 'https://api.groq.com/openai/v1'
const PREFERRED_MODELS = ['playai-tts']
// A composed, low-key male voice from Groq's PlayAI catalog. Non-PlayAI
// models need their own voice names — GROQ_TTS_VOICE overrides.
const DEFAULT_PLAYAI_VOICE = 'Basil-PlayAI'
const REQUEST_TIMEOUT_MS = 30_000

const DEAD_MODEL_RE = /decommissioned|no longer supported|does not exist|not found|invalid model/i
const TTS_MODEL_ID_RE = /tts|speech|orpheus/i

// Session cache: the model that actually worked, and ids Groq rejected.
let workingModel: string | null = null
const deadModels = new Set<string>()

/** Test hook: forget the discovered model and the dead list. */
export function resetGroqTtsModelCache(): void {
  workingModel = null
  deadModels.clear()
}

function baseUrl(): string {
  return process.env.GROQ_BASE_URL || DEFAULT_BASE_URL
}

function voiceFor(model: string): string | undefined {
  if (process.env.GROQ_TTS_VOICE) return process.env.GROQ_TTS_VOICE
  return /playai/i.test(model) ? DEFAULT_PLAYAI_VOICE : undefined
}

/** Ask Groq which models this key can use; keep the TTS-capable ones. */
async function discoverTtsModels(apiKey: string): Promise<string[]> {
  try {
    const response = await fetch(`${baseUrl()}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
    if (!response.ok) {
      console.error('[tts:groq] model discovery failed, HTTP', response.status)
      return []
    }
    const data = (await response.json()) as { data?: Array<{ id?: unknown }> }
    const ids = (data?.data ?? [])
      .map((entry) => entry?.id)
      .filter((id): id is string => typeof id === 'string')
      .filter((id) => TTS_MODEL_ID_RE.test(id) && !/whisper/i.test(id))
    console.log(`[tts:groq] discovered TTS models: ${ids.join(', ') || '(none)'}`)
    return ids
  } catch (error) {
    console.error('[tts:groq] model discovery failed', error)
    return []
  }
}

function candidateModels(): string[] {
  const pinned = process.env.GROQ_TTS_MODEL
  const ordered = [
    ...(pinned ? [pinned] : []),
    ...(workingModel ? [workingModel] : []),
    ...PREFERRED_MODELS
  ]
  // A pinned model is always attempted even if previously marked dead — the
  // user asked for it explicitly and deserves the real error.
  return [...new Set(ordered)].filter((model) => model === pinned || !deadModels.has(model))
}

interface AttemptResult {
  ok: boolean
  audio?: TtsAudio
  /** Model rejected as decommissioned/unknown — try the next candidate. */
  deadModel?: boolean
}

async function attemptSynthesis(
  apiKey: string,
  model: string,
  text: string
): Promise<AttemptResult> {
  const voice = voiceFor(model)
  let response: Response
  try {
    response = await fetch(`${baseUrl()}/audio/speech`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        ...(voice ? { voice } : {}),
        input: text,
        response_format: 'mp3'
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      console.error('[tts:groq] request timed out')
      throw new TtsRequestError('Voice synthesis timed out.')
    }
    console.error('[tts:groq] network error', error)
    throw new TtsRequestError('Could not reach the voice service.')
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '')
    console.error('[tts:groq] request failed', response.status, bodyText.slice(0, 300))

    if ((response.status === 400 || response.status === 404) && DEAD_MODEL_RE.test(bodyText)) {
      deadModels.add(model)
      if (workingModel === model) workingModel = null
      return { ok: false, deadModel: true }
    }
    if (response.status === 400 && /voice/i.test(bodyText)) {
      throw new TtsConfigError(
        `Groq TTS model "${model}" rejected the voice — set GROQ_TTS_VOICE to a voice that ` +
          'model supports (see console.groq.com/docs/text-to-speech).'
      )
    }
    if (response.status === 401 || response.status === 403) {
      throw new TtsConfigError('Voice service rejected the API key. Check GROQ_API_KEY.')
    }
    if (response.status === 429) {
      throw new TtsRequestError('Voice service rate limit reached.')
    }
    throw new TtsRequestError(`Voice synthesis failed (status ${response.status}).`)
  }

  const audio = new Uint8Array(await response.arrayBuffer())
  if (audio.byteLength === 0) {
    throw new TtsRequestError('Voice service returned empty audio.')
  }
  return { ok: true, audio: { audio, mimeType: 'audio/mpeg' } }
}

export const groqPlayAiProvider: TtsProvider = {
  name: 'groq',

  voiceLabel(): string {
    const model = process.env.GROQ_TTS_MODEL || workingModel || PREFERRED_MODELS[0]
    return `groq/${voiceFor(model) ?? model}`
  },

  isConfigured(): boolean {
    return Boolean(process.env.GROQ_API_KEY)
  },

  async synthesize(text: string): Promise<TtsAudio> {
    const apiKey = process.env.GROQ_API_KEY
    if (!apiKey) {
      throw new TtsConfigError(
        'Voice output is not configured. Set GROQ_API_KEY in your environment.'
      )
    }

    let tried = candidateModels()
    let discovered = false
    for (let index = 0; index < tried.length; index++) {
      const model = tried[index]
      const attempt = await attemptSynthesis(apiKey, model, text)
      if (attempt.ok && attempt.audio) {
        if (workingModel !== model) {
          console.log(`[tts:groq] using TTS model ${model}`)
          workingModel = model
        }
        return attempt.audio
      }
      // Dead model: on the first death, extend the candidate list with the
      // account's real TTS models from Groq's /models endpoint.
      if (attempt.deadModel && !discovered) {
        discovered = true
        const found = await discoverTtsModels(apiKey)
        tried = [...tried, ...found.filter((id) => !tried.includes(id) && !deadModels.has(id))]
      }
    }

    throw new TtsConfigError(
      'No supported Groq TTS model is available on this account (the previous model was ' +
        'decommissioned). Set GROQ_TTS_MODEL to a current model from console.groq.com/docs/models, ' +
        'or add ELEVENLABS_API_KEY. Replies remain text-only meanwhile.'
    )
  }
}
