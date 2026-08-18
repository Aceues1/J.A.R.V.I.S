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
// Fallback: the main chat model — proven working on this machine. Used when
// the gate model itself is rejected (decommissioned/renamed/bad params).
const FALLBACK_GATE_MODEL = (): string => process.env.GROQ_MODEL || 'openai/gpt-oss-120b'
const GATE_TIMEOUT_MS = 10_000
// gpt-oss are REASONING models: max_tokens caps reasoning + answer combined.
// A tight cap starves the reasoning channel and returns EMPTY content, which
// silently fails the gate closed. Keep generous headroom — the visible JSON
// answer itself is tiny.
const GATE_MAX_TOKENS = 768
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
{"search":false}
You have NO tools or functions available — never emit a tool or function call; write the JSON object as plain text.`

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
    console.error('[websearch:gate] no API key configured — skipping gate')
    return { search: false }
  }
  const baseUrl = process.env.GROQ_BASE_URL || DEFAULT_BASE_URL
  // After repeated 4xx rejections of the configured gate model, the session
  // switches to the proven fallback directly — one call per turn, not two.
  const model = stickyGateModel ?? (process.env.GROQ_GATE_MODEL || DEFAULT_GATE_MODEL)

  const recent = history
    .slice(-GATE_HISTORY_TURNS)
    .map((turn) => ({ role: turn.role, content: turn.content.slice(0, GATE_TURN_MAX_CHARS) }))

  console.log(`[websearch:gate] started (model=${model}) for: "${latest.slice(0, 80)}"`)
  const decision = await callGateModel(baseUrl, apiKey, model, recent, true)
  if (decision) {
    console.log(
      decision.search
        ? `[websearch:gate] decision: search=true query="${decision.query}"`
        : '[websearch:gate] decision: search=false'
    )
    return decision
  }
  console.error('[websearch:gate] gate unusable — failing closed (no search this turn)')
  return { search: false }
}

interface GateChoice {
  finish_reason?: unknown
  message?: { content?: unknown; reasoning?: unknown }
}

// Sticky model fallback: when the primary gate model keeps getting rejected
// with 4xx (e.g. gpt-oss phantom tool-calls: "Tool choice is none, but model
// called a tool"), stop paying a failed call + retry on every turn and use
// the fallback model directly for the rest of the session.
const STICKY_AFTER_FAILURES = 2
let primaryGateFailures = 0
let stickyGateModel: string | null = null

/** Test hook: forget sticky gate-model state. */
export function resetGateModelStickiness(): void {
  primaryGateFailures = 0
  stickyGateModel = null
}

/**
 * One gate request. Returns null when the call produced no usable decision.
 * If the gate model itself is rejected (HTTP 4xx — decommissioned model or
 * unsupported parameter), retries once with the main chat model, which is
 * known to work because ordinary chat uses it.
 */
async function callGateModel(
  baseUrl: string,
  apiKey: string,
  model: string,
  recent: Array<{ role: string; content: string }>,
  allowModelFallback: boolean
): Promise<GateDecision | null> {
  const body: Record<string, unknown> = {
    model,
    messages: [{ role: 'system', content: GATE_SYSTEM_PROMPT }, ...recent],
    temperature: 0,
    max_tokens: GATE_MAX_TOKENS
  }
  // Keep the reasoning channel short on reasoning models — the gate's answer
  // is one line of JSON; long deliberation is wasted latency and tokens.
  // json_object mode pins the output to the JSON channel, which also stops
  // gpt-oss from emitting phantom built-in tool calls ("Tool choice is none,
  // but model called a tool").
  if (model.includes('gpt-oss')) {
    body.reasoning_effort = 'low'
    body.response_format = { type: 'json_object' }
  }

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(GATE_TIMEOUT_MS)
    })
    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      console.error(`[websearch:gate] HTTP ${response.status}: ${errorText.slice(0, 200)}`)
      // 4xx = this model/parameter combination is rejected — retry once with
      // the main chat model before giving up. Repeated rejections make the
      // fallback sticky so future turns cost a single call again.
      const fallback = FALLBACK_GATE_MODEL()
      if (allowModelFallback && response.status < 500 && model !== fallback) {
        primaryGateFailures += 1
        if (primaryGateFailures >= STICKY_AFTER_FAILURES && !stickyGateModel) {
          stickyGateModel = fallback
          console.error(
            `[websearch:gate] gate model rejected ${primaryGateFailures}x — ` +
              `using ${fallback} directly for the rest of this session`
          )
        }
        console.error(`[websearch:gate] retrying with main chat model ${fallback}`)
        return callGateModel(baseUrl, apiKey, fallback, recent, false)
      }
      return null
    }
    if (allowModelFallback) primaryGateFailures = 0
    const data = (await response.json()) as { choices?: GateChoice[] }
    const choice = data?.choices?.[0]
    const content = typeof choice?.message?.content === 'string' ? choice.message.content : ''
    let decision = content ? parseGateReply(content) : null
    if (!decision) {
      // Reasoning models can return the text in message.reasoning with empty
      // content (especially when the token cap cuts the answer short).
      const reasoning =
        typeof choice?.message?.reasoning === 'string' ? choice.message.reasoning : ''
      if (reasoning) decision = parseGateReply(reasoning)
    }
    if (!decision) {
      console.error(
        `[websearch:gate] unparseable reply (finish_reason=${String(choice?.finish_reason)}, ` +
          `content_chars=${content.length}): "${content.slice(0, 160)}"`
      )
    }
    return decision
  } catch (error) {
    console.error('[websearch:gate] request failed', error)
    return null
  }
}
