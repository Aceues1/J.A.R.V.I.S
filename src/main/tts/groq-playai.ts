import { TtsConfigError, TtsRequestError, type TtsAudio, type TtsProvider } from './types'

// Groq's PlayAI text-to-speech — reuses the existing GROQ_API_KEY, so voice
// output works with zero extra configuration. Quality is good but less
// cinematic than ElevenLabs; it serves as the default fallback.
const DEFAULT_BASE_URL = 'https://api.groq.com/openai/v1'
const DEFAULT_MODEL = 'playai-tts'
// A composed, low-key male voice from Groq's PlayAI catalog.
const DEFAULT_VOICE = 'Basil-PlayAI'
const REQUEST_TIMEOUT_MS = 30_000

function getVoice(): string {
  return process.env.GROQ_TTS_VOICE || DEFAULT_VOICE
}

export const groqPlayAiProvider: TtsProvider = {
  name: 'groq',

  voiceLabel(): string {
    return `groq/${getVoice()}`
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
    const baseUrl = process.env.GROQ_BASE_URL || DEFAULT_BASE_URL
    const model = process.env.GROQ_TTS_MODEL || DEFAULT_MODEL

    let response: Response
    try {
      response = await fetch(`${baseUrl}/audio/speech`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, voice: getVoice(), input: text, response_format: 'mp3' }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      })
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError')
      ) {
        console.error('[tts:groq] request timed out')
        throw new TtsRequestError('Voice synthesis timed out.')
      }
      console.error('[tts:groq] network error', error)
      throw new TtsRequestError('Could not reach the voice service.')
    }

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '')
      console.error('[tts:groq] request failed', response.status, bodyText.slice(0, 500))

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
    return { audio, mimeType: 'audio/mpeg' }
  }
}
