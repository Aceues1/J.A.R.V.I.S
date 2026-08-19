// Free AI provider fallback chain for the MAIN chat model only.
//
// Order: Groq gpt-oss-120b (primary, fast, pacer-managed) → OpenRouter's free
// gpt-oss-120b (same weights — identical persona/envelope behavior) → Gemini
// free Flash via Google's OpenAI-compatible endpoint (deep reserve). The
// gate/curator/vision/STT calls ride separate Groq per-model buckets and are
// NOT routed through this chain — when the 120b bucket exhausts, they keep
// working on Groq.
//
// Legitimacy: each tier is one documented free tier on one account/key. No
// key rotation, no limit bypassing — an exhausted provider simply rests in
// cooldown until the window its own Retry-After advertised has passed.
//
// Privacy: Gemini's free tier may use prompts for training, so providers can
// declare omitPrivateContext — the persistent-memory block is withheld from
// their requests (persona, awareness, and live search context still go, so
// actions keep working). Groq/OpenRouter receive the normal full context.

export interface ChatProvider {
  /** Stable name for logs and cooldown tracking. Never log anything else. */
  readonly name: string
  /** Free tier may train on prompts → never receives the memory block. */
  readonly omitPrivateContext: boolean
  baseUrl(): string
  apiKey(): string | undefined
  model(): string
  /**
   * Authentication for this provider — exactly one scheme, never both.
   * Google's new AQ.-format keys are rejected by Bearer auth on the
   * OpenAI-compatible route, so Gemini authenticates with the native
   * x-goog-api-key header instead.
   */
  authHeaders(): Record<string, string>
  extraHeaders(): Record<string, string>
}

const groqProvider: ChatProvider = {
  name: 'groq',
  omitPrivateContext: false,
  baseUrl: () => process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1',
  apiKey: () => process.env.GROQ_API_KEY || undefined,
  model: () => process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
  authHeaders: () => ({ Authorization: `Bearer ${process.env.GROQ_API_KEY}` }),
  extraHeaders: () => ({})
}

const openRouterProvider: ChatProvider = {
  name: 'openrouter',
  omitPrivateContext: false,
  baseUrl: () => process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
  apiKey: () => process.env.OPENROUTER_API_KEY || undefined,
  // openrouter/free is OpenRouter's own rotating router over whatever free
  // models are currently live — individual ":free" slugs get delisted
  // without notice (gpt-oss-120b:free died Aug 2026), this alias does not.
  // Pin OPENROUTER_MODEL to a specific slug whenever a good one exists.
  model: () => process.env.OPENROUTER_MODEL || 'openrouter/free',
  authHeaders: () => ({ Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` }),
  // Optional app attribution per OpenRouter docs — a label, never data.
  extraHeaders: () => ({ 'X-Title': 'JARVIS' })
}

const geminiProvider: ChatProvider = {
  name: 'gemini',
  omitPrivateContext: true,
  baseUrl: () =>
    process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai',
  apiKey: () => process.env.GEMINI_API_KEY || undefined,
  model: () => process.env.GEMINI_MODEL || 'gemini-flash-latest',
  // Native Google auth header — works for both AIza and new AQ. keys, where
  // Bearer auth rejects the new format ("Please pass a valid API key").
  authHeaders: () => ({ 'x-goog-api-key': process.env.GEMINI_API_KEY || '' }),
  extraHeaders: () => ({})
}

/** Providers with a key configured, in fallback order. */
export function providerChain(): ChatProvider[] {
  return [groqProvider, openRouterProvider, geminiProvider].filter((provider) =>
    Boolean(provider.apiKey())
  )
}

// ---- cooldowns -------------------------------------------------------------
// Only genuine quota exhaustion (429 with a long Retry-After) parks a
// provider, for exactly the advertised window (capped). Transient errors and
// auth failures fail over within the turn but are re-tried next turn — a
// single 500 must not silence a healthy provider. Expiry needs no restart:
// the next turn simply finds the cooldown lapsed and probes the provider.
export const MAX_COOLDOWN_MS = 6 * 60 * 60 * 1000

const cooldowns = new Map<string, number>()

export function isCoolingDown(name: string): boolean {
  const until = cooldowns.get(name)
  return until !== undefined && Date.now() < until
}

export function setProviderCooldown(name: string, ms: number): void {
  cooldowns.set(name, Date.now() + Math.min(Math.max(ms, 0), MAX_COOLDOWN_MS))
}

/** True once for a provider that just came back from a lapsed cooldown. */
export function clearLapsedCooldown(name: string): boolean {
  const until = cooldowns.get(name)
  if (until === undefined || Date.now() < until) return false
  cooldowns.delete(name)
  return true
}

/** Test hooks. */
export function resetProviderCooldowns(): void {
  cooldowns.clear()
}
export function setProviderCooldownUntilForTests(name: string, until: number): void {
  cooldowns.set(name, until)
}
