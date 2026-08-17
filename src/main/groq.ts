const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions'
const DEFAULT_MODEL = 'llama-3.3-70b-versatile'

const SYSTEM_PROMPT =
  'You are JARVIS, a concise and helpful personal AI assistant running inside a desktop ' +
  'command-center interface. Keep replies clear and to the point. You do not currently have ' +
  'voice input/output, tool use, computer control, or trading/market capabilities — if asked ' +
  'to do any of those, say they are planned for a later phase rather than attempting them.'

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export class GroqConfigError extends Error {}
export class GroqRequestError extends Error {}

function getApiKey(): string {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) {
    throw new GroqConfigError(
      'AI backend is not configured. Set GROQ_API_KEY in your environment (see .env.example) and restart JARVIS.'
    )
  }
  return apiKey
}

export async function requestGroqReply(history: ChatTurn[]): Promise<string> {
  const apiKey = getApiKey()
  const model = process.env.GROQ_MODEL || DEFAULT_MODEL

  let response: Response
  try {
    response = await fetch(GROQ_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...history],
        temperature: 0.6,
        max_tokens: 1024
      })
    })
  } catch (error) {
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

  const data = await response.json()
  const content = data?.choices?.[0]?.message?.content

  if (typeof content !== 'string' || content.trim().length === 0) {
    console.error('[groq] unexpected response shape', data)
    throw new GroqRequestError('AI backend returned an empty response.')
  }

  return content
}
