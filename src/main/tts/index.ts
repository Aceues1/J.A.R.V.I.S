import { elevenLabsProvider } from './elevenlabs'
import { groqPlayAiProvider } from './groq-playai'
import { TtsConfigError, type TtsAudio, type TtsProvider } from './types'

export { TtsConfigError, TtsRequestError } from './types'

// Long replies are truncated for speech only — the full text still renders in
// the conversation. Keeps per-reply synthesis cost and latency bounded.
export const MAX_SPEAK_TEXT_LENGTH = 2000

const PROVIDERS: Record<string, TtsProvider> = {
  [elevenLabsProvider.name]: elevenLabsProvider,
  [groqPlayAiProvider.name]: groqPlayAiProvider
}

// TTS_PROVIDER pins a provider explicitly ('elevenlabs', 'groq', or 'off').
// Unset, the best configured provider wins: ElevenLabs when its key is
// present, otherwise Groq PlayAI on the existing GROQ_API_KEY.
export function resolveTtsProvider(): TtsProvider | null {
  const preference = (process.env.TTS_PROVIDER || '').trim().toLowerCase()
  if (preference === 'off' || preference === 'none') return null
  if (preference in PROVIDERS) return PROVIDERS[preference]
  if (elevenLabsProvider.isConfigured()) return elevenLabsProvider
  if (groqPlayAiProvider.isConfigured()) return groqPlayAiProvider
  return null
}

export function getTtsStatus(): { configured: boolean; provider: string; voice: string } {
  const provider = resolveTtsProvider()
  if (!provider) {
    return { configured: false, provider: 'off', voice: '' }
  }
  return {
    configured: provider.isConfigured(),
    provider: provider.name,
    voice: provider.voiceLabel()
  }
}

export function validateSpeakPayload(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null
  const { text } = payload as { text?: unknown }
  if (typeof text !== 'string') return null
  const trimmed = text.trim()
  if (trimmed.length === 0) return null
  return trimmed.slice(0, MAX_SPEAK_TEXT_LENGTH)
}

export async function synthesizeSpeech(text: string): Promise<TtsAudio> {
  const provider = resolveTtsProvider()
  if (!provider || !provider.isConfigured()) {
    throw new TtsConfigError('Voice output is not configured.')
  }
  return provider.synthesize(text)
}
