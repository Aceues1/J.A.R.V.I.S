import { GroqConfigError, GroqRequestError, getApiKey } from './groq'

// Speech-to-text via Groq's OpenAI-compatible audio transcription endpoint.
// Uses the same GROQ_API_KEY / GROQ_BASE_URL as the chat client so the key
// never leaves the main process. Kept separate from the chat client so
// text-to-speech can slot in beside it later.
const DEFAULT_BASE_URL = 'https://api.groq.com/openai/v1'
const DEFAULT_STT_MODEL = 'whisper-large-v3-turbo'
const REQUEST_TIMEOUT_MS = 30_000

// A 60s opus capture from MediaRecorder is well under 1 MB; this cap only
// guards the IPC channel against absurd payloads, not legitimate recordings.
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024

const EXTENSION_BY_MIME: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'mp4',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav'
}

export interface AudioPayload {
  audio: Uint8Array
  mimeType: string
}

export function getSttModel(): string {
  return process.env.GROQ_STT_MODEL || DEFAULT_STT_MODEL
}

export function validateAudioPayload(payload: unknown): AudioPayload | null {
  if (typeof payload !== 'object' || payload === null) return null
  const { audio, mimeType } = payload as { audio?: unknown; mimeType?: unknown }

  if (typeof mimeType !== 'string') return null
  // MediaRecorder reports e.g. "audio/webm;codecs=opus" — match on the base type.
  const baseMime = mimeType.split(';')[0].trim().toLowerCase()
  if (!(baseMime in EXTENSION_BY_MIME)) return null

  let bytes: Uint8Array
  if (audio instanceof Uint8Array) {
    bytes = audio
  } else if (audio instanceof ArrayBuffer) {
    bytes = new Uint8Array(audio)
  } else {
    return null
  }

  if (bytes.byteLength === 0 || bytes.byteLength > MAX_AUDIO_BYTES) return null

  return { audio: bytes, mimeType: baseMime }
}

export async function transcribeAudio({ audio, mimeType }: AudioPayload): Promise<string> {
  const apiKey = getApiKey()
  const baseUrl = process.env.GROQ_BASE_URL || DEFAULT_BASE_URL

  const form = new FormData()
  form.append(
    'file',
    new Blob([audio.slice()], { type: mimeType }),
    `speech.${EXTENSION_BY_MIME[mimeType]}`
  )
  form.append('model', getSttModel())
  form.append('response_format', 'json')
  form.append('temperature', '0')

  let response: Response
  try {
    response = await fetch(`${baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      console.error('[stt] request timed out')
      throw new GroqRequestError('Transcription timed out. Try a shorter recording.')
    }
    console.error('[stt] network error', error)
    throw new GroqRequestError('Could not reach the AI backend. Check your network connection.')
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '')
    console.error('[stt] request failed', response.status, bodyText)

    if (response.status === 401 || response.status === 403) {
      throw new GroqConfigError('AI backend rejected the API key. Check GROQ_API_KEY.')
    }
    if (response.status === 413) {
      throw new GroqRequestError('Recording is too large to transcribe. Try a shorter one.')
    }
    if (response.status === 429) {
      throw new GroqRequestError('AI backend rate limit reached. Try again shortly.')
    }
    throw new GroqRequestError(`Transcription failed (status ${response.status}).`)
  }

  let data: unknown
  try {
    data = await response.json()
  } catch (error) {
    console.error('[stt] invalid JSON in response', error)
    throw new GroqRequestError('Transcription service returned an unreadable response.')
  }

  const text = (data as { text?: unknown })?.text
  if (typeof text !== 'string') {
    console.error('[stt] unexpected response shape', data)
    throw new GroqRequestError('Transcription service returned an unexpected response.')
  }

  const trimmed = text.trim()
  if (trimmed.length === 0) {
    throw new GroqRequestError('No speech detected. Try again closer to the microphone.')
  }

  return trimmed
}
