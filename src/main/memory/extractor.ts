// Memory curation: a fast secondary Groq call that turns a conversation
// turn into typed store operations (add / update / delete). It sees the
// existing memories (with ids) so contradictions become UPDATES of the
// conflicting entry, and "forget X" becomes a DELETE — never blind
// duplicates, never wholesale overwrites of unrelated memories. All ops are
// strictly validated before touching the store.

import type { ChatTurn } from '../chat-validation'
import { getApiKey } from '../groq'
import { isMemoryType, MAX_CONTENT_CHARS, type MemoryEntry, type MemoryType } from './types'

const DEFAULT_BASE_URL = 'https://api.groq.com/openai/v1'
// Same family/limits as the search gate; override with GROQ_MEMORY_MODEL.
const DEFAULT_MEMORY_MODEL = 'openai/gpt-oss-20b'
const EXTRACT_TIMEOUT_MS = 12_000
// Reasoning models spend tokens thinking before the JSON answer — starving
// them returns empty content (the PRO 3 gate lesson). Keep real headroom.
const EXTRACT_MAX_TOKENS = 768
const HISTORY_TURNS = 6
const TURN_MAX_CHARS = 300
export const MAX_OPS_PER_TURN = 4

export type MemoryOp =
  | { op: 'add'; type: MemoryType; content: string }
  | { op: 'update'; id: string; content: string }
  | { op: 'delete'; id: string }

/**
 * Cheap local prescreen: only messages that plausibly carry durable info
 * (or explicit memory commands) are worth a curator call. Weather requests,
 * action commands, thanks, and ordinary questions never trigger extraction.
 */
export function isMemoryWorthy(text: string): boolean {
  return /\b(remember|forget|call me|my name is|i (actually |really |now )?(prefer|want|like|love|hate|need)|i'?d prefer|don'?t (ever )?(call|use)|from now on|going forward|always|never again|we(?:'re| are) (building|working|making)|the project is|this project is|i (have )?decided|we decided|let'?s go with|my (favou?rite|dog|cat|wife|husband|partner|birthday|job)|i work|i live|i am (a|an)\b|i'?m (a|an)\b)\b/i.test(
    text
  )
}

/** Explicit memory commands are handled synchronously so confirmations are honest. */
export function isExplicitMemoryCommand(text: string): boolean {
  return /\b(remember (that|this|it|me as)|please remember|don'?t remember|forget)\b/i.test(text)
}

/** "What do you remember?" — a listing request, not a store operation. */
export function isMemoryListingRequest(text: string): boolean {
  return /\b(what (do|did) you (remember|know) about|what do you remember|show me (what you remember|your memories|everything you remember)|what have you (remembered|stored)|list your memories)\b/i.test(
    text
  )
}

export const CURATOR_SYSTEM_PROMPT = `You are the memory curator for a desktop AI assistant. Given the recent conversation and the assistant's existing stored memories, decide what durable long-term information from the user's LATEST message should be stored, updated, or deleted.
Worth storing: stated preferences ("I prefer concise answers"), how the assistant should behave or address the user, stable personal facts the user states about themselves, ongoing project information, important decisions, and anything the user explicitly asks to remember.
NOT worth storing: questions, small talk, thanks, one-off requests (weather, prices, news, opening apps, playing videos, screen analysis), temporary states, speculation — and NEVER passwords, API keys, tokens, or any credential.
If the latest message contradicts or refines an existing memory, UPDATE that memory's id instead of adding a duplicate — newer explicit statements supersede older conflicting ones. DELETE a memory only when the user asks to forget it. Never touch memories unrelated to the latest message.
Reply with ONLY one single-line JSON object, nothing else:
{"ops":[{"op":"add","type":"preference|fact|project|decision","content":"concise third-person statement"},{"op":"update","id":"<existing id>","content":"..."},{"op":"delete","id":"<existing id>"}]}
Use {"ops":[]} when nothing should change. At most ${MAX_OPS_PER_TURN} ops.`

export function parseCuratorReply(reply: string, existing: MemoryEntry[]): MemoryOp[] {
  const trimmed = reply.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  const candidate = (fenced ? fenced[1] : trimmed).trim()
  const jsonMatch = candidate.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonMatch[0])
  } catch {
    return []
  }
  const rawOps = (parsed as { ops?: unknown[] })?.ops
  if (!Array.isArray(rawOps)) return []

  const knownIds = new Set(existing.map((entry) => entry.id))
  const ops: MemoryOp[] = []
  for (const raw of rawOps.slice(0, MAX_OPS_PER_TURN)) {
    const item = raw as { op?: unknown; type?: unknown; content?: unknown; id?: unknown }
    const content = typeof item.content === 'string' ? item.content.trim() : ''
    if (item.op === 'add' && isMemoryType(item.type) && content) {
      ops.push({ op: 'add', type: item.type, content: content.slice(0, MAX_CONTENT_CHARS) })
    } else if (
      item.op === 'update' &&
      typeof item.id === 'string' &&
      knownIds.has(item.id) &&
      content
    ) {
      ops.push({ op: 'update', id: item.id, content: content.slice(0, MAX_CONTENT_CHARS) })
    } else if (item.op === 'delete' && typeof item.id === 'string' && knownIds.has(item.id)) {
      ops.push({ op: 'delete', id: item.id })
    }
  }
  return ops
}

/**
 * Ask the curator model for store operations. Returns null when the call
 * itself failed (network/model/parse) so callers can report honestly —
 * distinct from a successful "nothing to store" ([]).
 */
export async function requestMemoryOps(
  history: ChatTurn[],
  existing: MemoryEntry[]
): Promise<MemoryOp[] | null> {
  let apiKey: string
  try {
    apiKey = getApiKey()
  } catch {
    return null
  }
  const baseUrl = process.env.GROQ_BASE_URL || DEFAULT_BASE_URL
  const model = process.env.GROQ_MEMORY_MODEL || DEFAULT_MEMORY_MODEL

  const existingBlock =
    existing.length > 0
      ? `Existing memories:\n${existing
          .map((entry) => `[${entry.id}] [${entry.type}] ${entry.content}`)
          .join('\n')}`
      : 'Existing memories: (none)'

  const recent = history
    .slice(-HISTORY_TURNS)
    .map((turn) => `${turn.role}: ${turn.content.slice(0, TURN_MAX_CHARS)}`)
    .join('\n')

  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: CURATOR_SYSTEM_PROMPT },
      { role: 'user', content: `${existingBlock}\n\nRecent conversation:\n${recent}` }
    ],
    temperature: 0,
    max_tokens: EXTRACT_MAX_TOKENS
  }
  if (model.includes('gpt-oss')) {
    body.reasoning_effort = 'low'
  }

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(EXTRACT_TIMEOUT_MS)
    })
    if (!response.ok) {
      console.error('[memory:extract] HTTP', response.status)
      return null
    }
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown; reasoning?: unknown } }>
    }
    const message = data?.choices?.[0]?.message
    const content = typeof message?.content === 'string' ? message.content : ''
    if (content) {
      const ops = parseCuratorReply(content, existing)
      if (ops.length > 0 || /"ops"\s*:\s*\[\s*\]/.test(content)) return ops
    }
    const reasoning = typeof message?.reasoning === 'string' ? message.reasoning : ''
    if (reasoning) {
      return parseCuratorReply(reasoning, existing)
    }
    console.error('[memory:extract] unparseable curator reply')
    return null
  } catch (error) {
    console.error('[memory:extract] request failed', error)
    return null
  }
}
