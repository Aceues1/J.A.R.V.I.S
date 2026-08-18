import type { ChatTurn } from './chat-validation'
import { SYSTEM_PROMPT } from './persona'
import { getAwarenessContext } from './awareness'

// GROQ_BASE_URL is a main-process-only override used by tests to point at a
// local mock server; production always talks to the real endpoint.
const DEFAULT_BASE_URL = 'https://api.groq.com/openai/v1'
// llama-3.3-70b-versatile was decommissioned by Groq in Aug 2026; requests for it now 404.
const DEFAULT_MODEL = 'openai/gpt-oss-120b'
const REQUEST_TIMEOUT_MS = 45_000

export class GroqConfigError extends Error {}
export class GroqRequestError extends Error {}

export function getGroqStatus(): { configured: boolean; model: string } {
  return {
    configured: Boolean(process.env.GROQ_API_KEY),
    model: process.env.GROQ_MODEL || DEFAULT_MODEL
  }
}

export function getApiKey(): string {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) {
    throw new GroqConfigError(
      'AI backend is not configured. Set GROQ_API_KEY in your environment (see .env.example) and restart JARVIS.'
    )
  }
  return apiKey
}

export async function requestGroqReply(
  history: ChatTurn[],
  extraContext?: string
): Promise<string> {
  const apiKey = getApiKey()
  const baseUrl = process.env.GROQ_BASE_URL || DEFAULT_BASE_URL
  const model = process.env.GROQ_MODEL || DEFAULT_MODEL
  // Awareness snapshot for this turn (time, location, schedule, system,
  // weather) — cheap: local reads plus the cached weather feed, with the
  // weather fetch capped so a cold/slow fetch never stalls the chat.
  const weatherContext = await getAwarenessContext()
  // Optional per-turn context (live web search results) rides after awareness.
  const systemContent = [SYSTEM_PROMPT, weatherContext, extraContext].filter(Boolean).join('\n\n')

  let response: Response
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: systemContent }, ...history],
        temperature: 0.6,
        max_tokens: 1024
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      console.error('[groq] request timed out')
      throw new GroqRequestError('AI backend timed out. Try again.')
    }
    console.error('[groq] network error', error)
    throw new GroqRequestError('Could not reach the AI backend. Check your network connection.')
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '')
    console.error('[groq] request failed', response.status, bodyText)

    if (response.status === 401 || response.status === 403) {
      throw new GroqConfigError('AI backend rejected the API key. Check GROQ_API_KEY.')
    }
    if (response.status === 429) {
      throw new GroqRequestError('AI backend rate limit reached. Try again shortly.')
    }
    throw new GroqRequestError(`AI backend returned an error (status ${response.status}).`)
  }

  let data: unknown
  try {
    data = await response.json()
  } catch (error) {
    console.error('[groq] invalid JSON in response', error)
    throw new GroqRequestError('AI backend returned an unreadable response.')
  }

  const content = (data as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]
    ?.message?.content

  if (typeof content !== 'string' || content.trim().length === 0) {
    console.error('[groq] unexpected response shape', data)
    throw new GroqRequestError('AI backend returned an empty response.')
  }

  return content
}
