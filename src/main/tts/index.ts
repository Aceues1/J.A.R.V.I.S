import { elevenLabsProvider } from './elevenlabs'
import { groqPlayAiProvider } from './groq-playai'
import { localKokoroProvider } from './local-kokoro'
import { TtsConfigError, type TtsAudio, type TtsProvider } from './types'

export { TtsConfigError, TtsRequestError } from './types'
export { warmUpLocalTts } from './local-kokoro'

// Long replies are truncated for speech only — the full text still renders in
// the conversation. Keeps per-reply synthesis cost and latency bounded.
export const MAX_SPEAK_TEXT_LENGTH = 2000

const PROVIDERS: Record<string, TtsProvider> = {
  [localKokoroProvider.name]: localKokoroProvider,
  [elevenLabsProvider.name]: elevenLabsProvider,
  [groqPlayAiProvider.name]: groqPlayAiProvider
}

// TTS_PROVIDER pins a provider explicitly ('local', 'elevenlabs', 'groq', or
// 'off'). Unset, the best configured provider wins: local Kokoro when
// LOCAL_TTS is on (no key needed), then ElevenLabs when its key is present,
// otherwise Groq PlayAI on the existing GROQ_API_KEY.
export function resolveTtsProvider(): TtsProvider | null {
  const preference = (process.env.TTS_PROVIDER || '').trim().toLowerCase()
  if (preference === 'off' || preference === 'none') return null
  if (preference in PROVIDERS) return PROVIDERS[preference]
  if (localKokoroProvider.isConfigured()) return localKokoroProvider
  if (elevenLabsProvider.isConfigured()) return elevenLabsProvider
  if (groqPlayAiProvider.isConfigured()) return groqPlayAiProvider
  return null
}

// The cloud chain behind the local voice, in the existing priority order.
// Cloud provider semantics are unchanged — only the local provider falls
// back, so cloud-only setups behave exactly as before this provider existed.
function resolveCloudFallback(): TtsProvider | null {
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

// The same reply text feeds both the conversation UI and the voice. The UI
// keeps the original; for speech we drop markdown scaffolding that reads
// poorly aloud. The persona discourages markdown in conversation, so this is
// a safety net, not a formatter.
export function prepareSpeechText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' Code omitted. ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function validateSpeakPayload(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null
  const { text } = payload as { text?: unknown }
  if (typeof text !== 'string') return null
  const spoken = prepareSpeechText(text)
  if (spoken.length === 0) return null
  return spoken.slice(0, MAX_SPEAK_TEXT_LENGTH)
}

export async function synthesizeSpeech(text: string): Promise<TtsAudio> {
  const provider = resolveTtsProvider()
  if (!provider || !provider.isConfigured()) {
    throw new TtsConfigError('Voice output is not configured.')
  }
  if (provider.name !== localKokoroProvider.name) {
    return provider.synthesize(text)
  }
  // Local voice first; when it cannot serve (model still loading, first-run
  // download, load failure) the existing cloud chain speaks instead, so the
  // reply is never silent just because the local model is not ready yet.
  // When local succeeds, the text never leaves this machine.
  try {
    return await provider.synthesize(text)
  } catch (error) {
    const fallback = resolveCloudFallback()
    if (!fallback) throw error
    const reason = error instanceof Error ? error.message : 'unknown error'
    console.log(`[tts] local voice unavailable (${reason}) — falling back to ${fallback.name}`)
    return fallback.synthesize(text)
  }
}
