import { TtsConfigError, TtsRequestError, type TtsAudio, type TtsProvider } from './types'

// ElevenLabs text-to-speech — the high-quality option for a polished
// assistant voice. Requires its own ELEVENLABS_API_KEY.
const DEFAULT_BASE_URL = 'https://api.elevenlabs.io/v1'
// "George" — a stock ElevenLabs narration voice with a warm, measured
// British delivery. A stock catalog voice, not a clone of any real actor.
const DEFAULT_VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb'
const DEFAULT_MODEL = 'eleven_multilingual_v2'
const REQUEST_TIMEOUT_MS = 30_000

function getVoiceId(): string {
  return process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID
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
            voice_settings: { stability: 0.5, similarity_boost: 0.75 }
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
