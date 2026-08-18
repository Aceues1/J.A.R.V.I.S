// The search gate, required by the Pro Guide: before any general web search,
// a fast secondary Groq call decides whether the message actually needs LIVE
// data. Trivial messages ("hey", "ok", greetings, thanks) never even reach
// the gate — a local filter answers those for free. The gate also rewrites
// the request into a standalone search query, resolving pronouns from the
// recent conversation ("what about today?" → "OpenAI news today").

import type { ChatTurn } from '../chat-validation'
import { getApiKey } from '../groq'

const DEFAULT_BASE_URL = 'https://api.groq.com/openai/v1'
// Small, fast model for the yes/no gate; override with GROQ_GATE_MODEL.
const DEFAULT_GATE_MODEL = 'openai/gpt-oss-20b'
const GATE_TIMEOUT_MS = 10_000
// Enough turns to resolve "them"/"it" without shipping the whole transcript.
const GATE_HISTORY_TURNS = 6
const GATE_TURN_MAX_CHARS = 300

export type GateDecision = { search: false } | { search: true; query: string }

// Trivial conversational messages that must not trigger a gate call at all.
const TRIVIAL_RE = new RegExp(
  '^(?:' +
    'hey|hi|hiya|hello|yo|sup|howdy|' +
    'good\\s+(?:morning|afternoon|evening|night)|' +
    'thanks?|thank\\s+you|thx|cheers|' +
    'ok(?:ay)?|k|sure|fine|alright|right|got\\s+it|understood|' +
    'yes|yeah|yep|yup|no|nope|nah|maybe|' +
    "(?:that'?s\\s+)?(?:cool|nice|great|awesome|funny|good|fine)|" +
    'lol|haha+|hehe+|wow|hmm+|' +
    'bye|goodbye|see\\s+you|later|good\\s+night|' +
    'stop|never\\s*mind|nothing' +
    ')(?:\\s*,?\\s*(?:jarvis|sir|man|mate))?[\\s.!?…]*$',
  'i'
)

/** Local, zero-cost check: greetings/acknowledgements skip the gate entirely. */
export function isTrivialMessage(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return true
  return TRIVIAL_RE.test(trimmed)
}

export const GATE_SYSTEM_PROMPT = `You are the web-search gate for a desktop AI assistant. Given a conversation, decide whether answering the user's LATEST message requires LIVE current information from the web.
Live information is needed for: news and current events; anything "latest", "today", "right now", "currently"; current prices (crypto, stocks, indexes); recent sports results; weather outside Sistranda/Frøya/Trondheim; social media follower counts; and any explicit request to search, look up, research, or find current information.
NOT needed for: greetings and small talk; opinions, advice, jokes; math, coding, writing help; stable general knowledge (history, science, definitions, "what is X"); weather in Sistranda, Frøya, or Trondheim (a live feed already covers those); requests to open apps/websites, play or control videos, or analyze the screen.
Reply with ONLY one single-line JSON object, nothing else:
{"search":true,"query":"<standalone web search query — resolve pronouns like it/them/that from the conversation>"}
or
{"search":false}`

function parseGateReply(reply: string): GateDecision | null {
  const trimmed = reply.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  const candidate = (fenced ? fenced[1] : trimmed).trim()
  const jsonMatch = candidate.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return null
  try {
    const parsed = JSON.parse(jsonMatch[0]) as { search?: unknown; query?: unknown }
    if (parsed.search === false) return { search: false }
    if (parsed.search === true && typeof parsed.query === 'string' && parsed.query.trim()) {
      return { search: true, query: parsed.query.trim().slice(0, 200) }
    }
  } catch {
    // fall through
  }
  return null
}

/**
 * Ask the gate model whether the latest message needs live data. Fails
 * CLOSED: any gate failure (network, timeout, unparseable reply) returns
 * {search:false} so chat continues normally — a broken gate must never
 * break conversation.
 */
export async function runSearchGate(history: ChatTurn[]): Promise<GateDecision> {
  const latest =
    [...history]
      .reverse()
      .find((turn) => turn.role === 'user')
      ?.content?.trim() ?? ''
  if (!latest || isTrivialMessage(latest)) return { search: false }

  let apiKey: string
  try {
    apiKey = getApiKey()
  } catch {
    return { search: false }
  }
  const baseUrl = process.env.GROQ_BASE_URL || DEFAULT_BASE_URL
  const model = process.env.GROQ_GATE_MODEL || DEFAULT_GATE_MODEL

  const recent = history
    .slice(-GATE_HISTORY_TURNS)
    .map((turn) => ({ role: turn.role, content: turn.content.slice(0, GATE_TURN_MAX_CHARS) }))

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: GATE_SYSTEM_PROMPT }, ...recent],
        temperature: 0,
        max_tokens: 120
      }),
      signal: AbortSignal.timeout(GATE_TIMEOUT_MS)
    })
    if (!response.ok) {
      console.error('[websearch:gate] HTTP', response.status)
      return { search: false }
    }
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>
    }
    const content = data?.choices?.[0]?.message?.content
    if (typeof content !== 'string') return { search: false }
    return parseGateReply(content) ?? { search: false }
  } catch (error) {
    console.error('[websearch:gate] failed', error)
    return { search: false }
  }
}
