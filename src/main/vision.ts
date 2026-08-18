import { GroqConfigError, GroqRequestError, getApiKey } from './groq'
import { SYSTEM_PROMPT } from './persona'

// Screen analysis via a vision-capable Groq model. Note on guide compliance:
// the Pro Guide references llama-3.2-11b-vision-preview, which Groq
// decommissioned (as was its successor, llama-4-scout, in June 2026). The
// closest currently supported vision model is qwen/qwen3.6-27b; override
// with GROQ_VISION_MODEL if the account has something better.
const DEFAULT_BASE_URL = 'https://api.groq.com/openai/v1'
const DEFAULT_VISION_MODEL = 'qwen/qwen3.6-27b'
const REQUEST_TIMEOUT_MS = 60_000
// Groq vision accepts at most 5 images per request.
export const MAX_SCREENS = 5

export interface ScreenImage {
  /** e.g. "Display 1 (primary, 2560x1440)" */
  label: string
  /** data:image/jpeg;base64,... */
  dataUrl: string
}

const VISION_INSTRUCTIONS =
  '\n\n# Screen analysis\n' +
  "You are looking at screenshots of the user's monitors, captured just now at their " +
  'request. Each image is labelled. Two modes:\n' +
  '- General request ("analyze my screen", "what do you see?"): describe what the user is ' +
  'looking at naturally and conversationally, leading with what matters — never a robotic ' +
  'inventory of windows and buttons.\n' +
  '- Specific question ("what does this error mean?", "what am I doing wrong?"): answer the ' +
  'question directly using the screenshot as context; do not first describe everything visible.\n' +
  'Only describe what is actually in the images; if something is unreadable or off-screen, ' +
  'say so. Reply as spoken prose for the voice channel.'

export function getVisionModel(): string {
  return process.env.GROQ_VISION_MODEL || DEFAULT_VISION_MODEL
}

export async function analyzeScreens(question: string, screens: ScreenImage[]): Promise<string> {
  const apiKey = getApiKey()
  if (screens.length === 0) {
    throw new GroqRequestError('Screen capture produced no images.')
  }
  const baseUrl = process.env.GROQ_BASE_URL || DEFAULT_BASE_URL

  const content: Array<Record<string, unknown>> = [
    {
      type: 'text',
      text:
        `${question.trim() || 'Analyze my screen and tell me what you see.'}\n\n` +
        screens.map((screen, i) => `Image ${i + 1}: ${screen.label}`).join('\n')
    },
    ...screens.slice(0, MAX_SCREENS).map((screen) => ({
      type: 'image_url',
      image_url: { url: screen.dataUrl }
    }))
  ]

  let response: Response
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: getVisionModel(),
        messages: [
          { role: 'system', content: SYSTEM_PROMPT + VISION_INSTRUCTIONS },
          { role: 'user', content }
        ],
        temperature: 0.5,
        max_tokens: 1024
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      console.error('[vision] request timed out')
      throw new GroqRequestError('Screen analysis timed out.')
    }
    console.error('[vision] network error', error)
    throw new GroqRequestError('Could not reach the vision service.')
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '')
    console.error('[vision] request failed', response.status, bodyText.slice(0, 500))
    if (response.status === 401 || response.status === 403) {
      throw new GroqConfigError('The vision service rejected the API key. Check GROQ_API_KEY.')
    }
    if (response.status === 429) {
      throw new GroqRequestError('The vision service rate limit was reached. Try again shortly.')
    }
    throw new GroqRequestError(`Screen analysis failed (status ${response.status}).`)
  }

  let data: unknown
  try {
    data = await response.json()
  } catch (error) {
    console.error('[vision] invalid JSON in response', error)
    throw new GroqRequestError('The vision service returned an unreadable response.')
  }

  const text = (data as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]
    ?.message?.content
  if (typeof text !== 'string' || text.trim().length === 0) {
    console.error('[vision] unexpected response shape')
    throw new GroqRequestError('The vision service returned an empty response.')
  }
  return text.trim()
}
