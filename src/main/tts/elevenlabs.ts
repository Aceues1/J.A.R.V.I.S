import { TtsConfigError, TtsRequestError, type TtsAudio, type TtsProvider } from './types'

// ElevenLabs text-to-speech — the high-quality option for a polished
// assistant voice. Requires its own ELEVENLABS_API_KEY.
const DEFAULT_BASE_URL = 'https://api.elevenlabs.io/v1'
// "Daniel" — a stock ElevenLabs voice: British, composed, precise, with a
// slightly detached delivery that suits an AI assistant. An original catalog
// voice, not a clone of any real actor.
const DEFAULT_VOICE_ID = 'onwK4e9ZLuTAKqWW03F9'
const DEFAULT_MODEL = 'eleven_multilingual_v2'
// Higher stability flattens theatrical swings into the calm, even delivery
// an assistant voice wants; similarity keeps it close to the source voice.
const DEFAULT_STABILITY = 0.62
const DEFAULT_SIMILARITY = 0.8
const REQUEST_TIMEOUT_MS = 30_000

function getVoiceId(): string {
  return process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID
}

function getTuning(name: string, fallback: number): number {
  const raw = Number(process.env[name])
  return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : fallback
}

export const elevenLabsProvider: TtsProvider = {
  name: 'elevenlabs',

  voiceLabel(): string {
    return `elevenlabs/${getVoiceId()}`
  },

  isConfigured(): boolean {
    return Boolean(process.env.ELEVENLABS_API_KEY)
  },

  async synthesize(text: string): Promise<TtsAudio> {
    const apiKey = process.env.ELEVENLABS_API_KEY
    if (!apiKey) {
      throw new TtsConfigError(
        'Voice output is not configured. Set ELEVENLABS_API_KEY in your environment.'
      )
    }
    const baseUrl = process.env.ELEVENLABS_BASE_URL || DEFAULT_BASE_URL
    const model = process.env.ELEVENLABS_TTS_MODEL || DEFAULT_MODEL

    let response: Response
    try {
      response = await fetch(
        `${baseUrl}/text-to-speech/${getVoiceId()}?output_format=mp3_44100_128`,
        {
          method: 'POST',
          headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            model_id: model,
            voice_settings: {
              stability: getTuning('ELEVENLABS_STABILITY', DEFAULT_STABILITY),
              similarity_boost: getTuning('ELEVENLABS_SIMILARITY', DEFAULT_SIMILARITY)
            }
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        }
      )
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError')
      ) {
        console.error('[tts:elevenlabs] request timed out')
        throw new TtsRequestError('Voice synthesis timed out.')
      }
      console.error('[tts:elevenlabs] network error', error)
      throw new TtsRequestError('Could not reach the voice service.')
    }

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '')
      console.error('[tts:elevenlabs] request failed', response.status, bodyText.slice(0, 500))

      if (response.status === 401 || response.status === 403) {
        throw new TtsConfigError('Voice service rejected the API key. Check ELEVENLABS_API_KEY.')
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
