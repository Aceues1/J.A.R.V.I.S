import type { ChatTurn } from './chat-validation'
import { SYSTEM_PROMPT } from './persona'
import { getAwarenessContext } from './awareness'
import {
  MAX_COOLDOWN_MS,
  clearLapsedCooldown,
  isCoolingDown,
  providerChain,
  setProviderCooldown,
  type ChatProvider
} from './providers'

// GROQ_BASE_URL is a main-process-only override used by tests to point at a
// local mock server; production always talks to the real endpoint.
// llama-3.3-70b-versatile was decommissioned by Groq in Aug 2026; requests for it now 404.
const DEFAULT_MODEL = 'openai/gpt-oss-120b'
const REQUEST_TIMEOUT_MS = 45_000

export class GroqConfigError extends Error {}
export class GroqRequestError extends Error {}

export function getGroqStatus(): { configured: boolean; model: string } {
  return {
    configured: providerChain().length > 0,
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

// Token-efficiency caps (main 120b call only; validation storage caps are
// unchanged in chat-validation.ts — this trims only what is SENT).
// 16 turns comfortably covers pronoun resolution, action context, and the
// video-vs-Spotify pause/resume disambiguation; PRO 4 memory carries durable
// facts beyond the window.
export const MAX_SENT_TURNS = 16
export const MAX_SENT_MESSAGE_CHARS = 1200
// Output cap: persona-contract replies are short spoken prose and envelopes
// are one line; 640 (with low reasoning effort) leaves ample room.
export const MAX_REPLY_TOKENS = 640
// One polite retry on temporary 429s. TPM windows advertise Retry-After up
// to about a minute; anything longer is daily/monthly quota exhaustion,
// reported honestly instead of retried.
const RETRY_MAX_WAIT_MS = 60_000
const RETRY_DEFAULT_WAIT_MS = 2_000

// ---- client-side TPM budget pacer -----------------------------------------
// Groq's limiter charges each request (input tokens + max_tokens reservation)
// against a rolling 60-second window. Measured: three consecutive turns cost
// ~9.6k against the account's 8k TPM — the third command 429s. The pacer
// keeps a matching ledger and, when a request would overrun the budget,
// waits exactly until enough of the window rolls off (never an arbitrary
// delay). The budget defaults conservatively under the account limit and is
// configurable via GROQ_TPM_BUDGET (a paid tier makes pacing a no-op).
const DEFAULT_TPM_BUDGET = 7_200
const PACE_WINDOW_MS = 60_000
export const MAX_PACE_WAIT_MS = 45_000

interface LedgerEntry {
  at: number
  tokens: number
}
let ledger: LedgerEntry[] = []
// Serializes budget checks so concurrent requests cannot race the ledger.
let paceQueue: Promise<void> = Promise.resolve()

/** Test hook: forget all recorded charges. */
export function resetRateLedger(): void {
  ledger = []
}

function tpmBudget(): number {
  const raw = Number(process.env.GROQ_TPM_BUDGET)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TPM_BUDGET
}

/** The same estimate Groq's limiter uses: input chars/4 plus the output reservation. */
export function estimateTpmCharge(messages: Array<{ content: string }>, maxTokens: number): number {
  const contentChars = messages.reduce((total, message) => total + message.content.length, 0)
  return Math.round(contentChars / 4) + maxTokens
}

/**
 * Record this request's charge, first waiting (bounded) if the rolling
 * window can't fit it yet. Requests queue through one lock, so parallel
 * callers cannot bypass the accounting.
 */
export async function reserveTpmBudget(tokens: number): Promise<void> {
  const previous = paceQueue
  let release!: () => void
  paceQueue = new Promise((resolve) => {
    release = resolve
  })
  await previous
  try {
    const now = Date.now()
    ledger = ledger.filter((entry) => now - entry.at < PACE_WINDOW_MS)
    const used = ledger.reduce((total, entry) => total + entry.tokens, 0)
    const budget = tpmBudget()

    if (used + tokens > budget && ledger.length > 0) {
      // Walk the (chronological) ledger until enough charges have expired.
      let waitMs = 0
      let remaining = used
      for (const entry of ledger) {
        waitMs = entry.at + PACE_WINDOW_MS - now
        remaining -= entry.tokens
        if (remaining + tokens <= budget) break
      }
      waitMs = Math.min(Math.max(waitMs, 0), MAX_PACE_WAIT_MS)
      if (waitMs > 0) {
        console.log(`[groq] pacing ${Math.ceil(waitMs / 1000)}s to stay inside the rate window`)
        await new Promise((resolve) => setTimeout(resolve, waitMs))
      }
    }
    ledger.push({ at: Date.now(), tokens })
  } finally {
    release()
  }
}
// ---------------------------------------------------------------------------

/** Trim the transcript sent to the model; long messages are clipped. */
export function trimHistoryForPrompt(history: ChatTurn[]): ChatTurn[] {
  return history
    .slice(-MAX_SENT_TURNS)
    .map((turn) =>
      turn.content.length > MAX_SENT_MESSAGE_CHARS
        ? { role: turn.role, content: `${turn.content.slice(0, MAX_SENT_MESSAGE_CHARS)} […]` }
        : turn
    )
}

function retryWaitMs(response: Response): number {
  const header = response.headers?.get?.('retry-after')
  const seconds = Number(header)
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : RETRY_DEFAULT_WAIT_MS
}

// One request to one provider, with the single short-window 429 retry.
// Never throws — the caller decides whether a failure fails over or surfaces.
// cooldownMs is set only when re-calling the provider soon is pointless:
// 'quota' = 429 with a Retry-After beyond the retry ceiling (rest exactly
// that long); 'model' = the configured model itself is rejected (404 — e.g.
// a delisted OpenRouter free slug), which won't heal within the session.
type ProviderAttempt =
  | { ok: true; content: string }
  | {
      ok: false
      error: GroqConfigError | GroqRequestError
      cooldownMs?: number
      cooldownReason?: 'quota' | 'model'
    }

async function attemptChatCompletion(
  provider: ChatProvider,
  requestBody: Record<string, unknown>
): Promise<ProviderAttempt> {
  const tag = `[${provider.name}]`
  let response: Response
  for (let attempt = 0; ; attempt++) {
    try {
      response = await fetch(`${provider.baseUrl()}/chat/completions`, {
        method: 'POST',
        headers: {
          // Exactly one auth scheme per provider (Gemini's compat endpoint
          // rejects requests carrying both Bearer and the native header).
          ...provider.authHeaders(),
          'Content-Type': 'application/json',
          ...provider.extraHeaders()
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      })
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError')
      ) {
        console.error(`${tag} request timed out`)
        return { ok: false, error: new GroqRequestError('AI backend timed out. Try again.') }
      }
      console.error(`${tag} network error`, error)
      return {
        ok: false,
        error: new GroqRequestError(
          'Could not reach the AI backend. Check your network connection.'
        )
      }
    }

    // Temporary rate limit: wait once for the advertised window and retry.
    // Anything longer than the cap is real quota exhaustion — hand the
    // window back so the chain can cool this provider down and fail over.
    if (response.status === 429 && attempt === 0) {
      const waitMs = retryWaitMs(response)
      if (waitMs <= RETRY_MAX_WAIT_MS) {
        console.error(`${tag} 429 — retrying once after ${waitMs}ms`)
        await new Promise((resolve) => setTimeout(resolve, waitMs))
        continue
      }
      console.error(`${tag} 429 with retry-after ${waitMs}ms — limit exhausted, not retrying`)
      return {
        ok: false,
        error: new GroqRequestError('AI backend rate limit reached. Try again shortly.'),
        cooldownMs: waitMs,
        cooldownReason: 'quota'
      }
    }
    break
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '')
    console.error(`${tag} request failed`, response.status, bodyText)

    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        error: new GroqConfigError(
          `AI backend rejected the API key. Check ${provider.name.toUpperCase()}_API_KEY.`
        )
      }
    }
    if (response.status === 429) {
      return {
        ok: false,
        error: new GroqRequestError('AI backend rate limit reached. Try again shortly.')
      }
    }
    if (response.status === 404) {
      // The configured model itself is gone (delisted free slug, renamed,
      // decommissioned). Re-calling every turn is pointless — rest the
      // provider and advise the override knob in the log, never in errors.
      console.error(
        `${tag} model not available — cooling this provider down. ` +
          `Set ${provider.name.toUpperCase()}_MODEL to a current model to override.`
      )
      return {
        ok: false,
        error: new GroqRequestError(`AI backend returned an error (status 404).`),
        cooldownMs: MAX_COOLDOWN_MS,
        cooldownReason: 'model'
      }
    }
    return {
      ok: false,
      error: new GroqRequestError(`AI backend returned an error (status ${response.status}).`)
    }
  }

  let data: unknown
  try {
    data = await response.json()
  } catch (error) {
    console.error(`${tag} invalid JSON in response`, error)
    return { ok: false, error: new GroqRequestError('AI backend returned an unreadable response.') }
  }

  const content = (data as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]
    ?.message?.content

  if (typeof content !== 'string' || content.trim().length === 0) {
    console.error(`${tag} unexpected response shape`, data)
    return { ok: false, error: new GroqRequestError('AI backend returned an empty response.') }
  }

  return { ok: true, content }
}

/**
 * Main chat request with automatic free-provider failover.
 *
 * `extraContext` (live web search) goes to every provider; `privateContext`
 * (persistent memory) is withheld from providers whose free tier may train
 * on prompts (Gemini). Apart from that one omission, every provider receives
 * the byte-identical persona, awareness, context, and history — the envelope
 * contract does not change with the transport.
 *
 * Failover happens within the turn: quota-exhausted providers (429 with a
 * long Retry-After) go into cooldown for the advertised window and are
 * skipped until it lapses, then probed again automatically — no restart, no
 * .env change. Transient failures (5xx/timeout/network/empty) fail over this
 * turn but are re-tried next turn. If nothing can serve, the error is honest.
 */
export async function requestGroqReply(
  history: ChatTurn[],
  extraContext?: string,
  privateContext?: string
): Promise<string> {
  const chain = providerChain()
  if (chain.length === 0) {
    throw new GroqConfigError(
      'AI backend is not configured. Set GROQ_API_KEY in your environment (see .env.example) and restart JARVIS.'
    )
  }
  // Awareness snapshot for this turn (time, location, schedule, system,
  // weather) — cheap: local reads plus the cached weather feed, with the
  // weather fetch capped so a cold/slow fetch never stalls the chat.
  const weatherContext = await getAwarenessContext()
  const trimmedHistory = trimHistoryForPrompt(history)

  let lastError: GroqConfigError | GroqRequestError | null = null
  for (let index = 0; index < chain.length; index++) {
    const provider = chain[index]
    if (isCoolingDown(provider.name)) continue
    const wasCooling = clearLapsedCooldown(provider.name)

    // Per-turn context (memory + live web search) rides after awareness, in
    // the same order as always; memory is dropped for omitPrivateContext.
    const systemContent = [
      SYSTEM_PROMPT,
      weatherContext,
      provider.omitPrivateContext ? undefined : privateContext,
      extraContext
    ]
      .filter(Boolean)
      .join('\n\n')
    const model = provider.model()
    const requestBody: Record<string, unknown> = {
      model,
      messages: [{ role: 'system', content: systemContent }, ...trimmedHistory],
      temperature: 0.6,
      max_tokens: MAX_REPLY_TOKENS
    }
    // gpt-oss models spend max_tokens on reasoning before the visible reply;
    // low effort keeps the deliberation short so the tighter cap stays safe.
    // (Gemini's compat endpoint gets no gpt-oss-specific knobs.)
    if (model.includes('gpt-oss')) {
      requestBody.reasoning_effort = 'low'
    }

    // Pace against Groq's rolling TPM window BEFORE sending — prevents the
    // 429 instead of reacting to it. Groq-specific: the fallbacks are
    // request-count limited far above conversational speed.
    if (provider.name === 'groq') {
      await reserveTpmBudget(
        estimateTpmCharge(requestBody.messages as Array<{ content: string }>, MAX_REPLY_TOKENS)
      )
    }

    const attempt = await attemptChatCompletion(provider, requestBody)
    if (attempt.ok) {
      if (wasCooling) console.log(`[ai] ${provider.name} recovered — back in service`)
      if (provider.name !== 'groq') console.log(`[ai] reply served by ${provider.name}`)
      return attempt.content
    }
    lastError = attempt.error
    if (attempt.cooldownMs !== undefined) {
      setProviderCooldown(provider.name, attempt.cooldownMs)
      const next = chain.slice(index + 1).find((candidate) => !isCoolingDown(candidate.name))
      const cause =
        attempt.cooldownReason === 'model'
          ? 'model unavailable — cooling down'
          : `exhausted (retry-after ${Math.round(attempt.cooldownMs / 1000)}s)`
      console.log(
        `[ai] ${provider.name} ${cause} — ` +
          (next ? `failing over to ${next.name}` : 'no fallback available')
      )
    }
  }

  // Nothing served: surface the last real failure, or — when every provider
  // was already cooling down — the honest rate-limit message.
  throw lastError ?? new GroqRequestError('AI backend rate limit reached. Try again shortly.')
}
