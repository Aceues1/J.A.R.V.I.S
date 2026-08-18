// Memory manager — the single integration point for chat. Per turn:
//   • listing requests  → full listing block (synchronous, honest)
//   • explicit commands → curator ops applied BEFORE the reply, so the
//     model confirms only what actually happened
//   • everything else   → relevant-memory block now; extraction runs in the
//     BACKGROUND after the reply so responses stay fast
// Every path is failure-isolated: memory can be broken, missing, or corrupt
// and chat still works — JARVIS just says memory is unavailable when asked.

import type { ChatTurn } from '../chat-validation'
import {
  isExplicitMemoryCommand,
  isMemoryListingRequest,
  isMemoryWorthy,
  requestMemoryOps,
  type MemoryOp
} from './extractor'
import { formatMemoryBlock, selectRelevantMemories } from './retrieval'
import { addMemory, deleteMemory, listMemories, updateMemory } from './store'
import type { MemoryEntry } from './types'

export { registerMemoryDir } from './store'

export interface MemoryTurnContext {
  /** Prompt block for this turn ("# Persistent memory" …). */
  block: string
  /** Short human-readable note for the diagnostics feed. */
  note?: string
}

const LISTING_CAP = 30

function latestUserMessage(history: ChatTurn[]): string {
  return (
    [...history]
      .reverse()
      .find((turn) => turn.role === 'user')
      ?.content?.trim() ?? ''
  )
}

function describeOp(op: MemoryOp, entry: MemoryEntry | null): string {
  if (op.op === 'add') return `Stored [${op.type}] "${entry?.content ?? op.content}"`
  if (op.op === 'update') return `Updated memory to "${op.content}"`
  return `Deleted memory "${entry?.content ?? op.id}"`
}

/** Apply curator ops one by one; a failing op never blocks the others. */
export function applyMemoryOps(ops: MemoryOp[]): { applied: string[]; failed: string[] } {
  const applied: string[] = []
  const failed: string[] = []
  for (const op of ops) {
    try {
      if (op.op === 'add') {
        const entry = addMemory({ type: op.type, content: op.content, source: 'explicit' })
        applied.push(describeOp(op, entry))
      } else if (op.op === 'update') {
        const entry = updateMemory(op.id, op.content)
        applied.push(describeOp(op, entry))
      } else {
        const entry = deleteMemory(op.id)
        applied.push(describeOp(op, entry))
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'failed'
      console.error(`[memory] op ${op.op} failed:`, reason)
      failed.push(`${op.op.toUpperCase()} FAILED (${reason})`)
    }
  }
  return { applied, failed }
}

const UNAVAILABLE_STATUS =
  'The memory system is temporarily unavailable — nothing was stored or forgotten. Tell the ' +
  'user honestly; do not claim success.'

/**
 * Build this turn's memory context. Synchronous store work + (for explicit
 * commands only) one curator call. NEVER throws.
 */
export async function getMemoryTurnContext(history: ChatTurn[]): Promise<MemoryTurnContext | null> {
  const lastUser = latestUserMessage(history)
  if (!lastUser) return null

  let memories: MemoryEntry[]
  try {
    memories = listMemories()
  } catch (error) {
    console.error('[memory] store unavailable', error)
    // Only surface the failure when the user is actually talking about memory.
    if (isMemoryListingRequest(lastUser) || isExplicitMemoryCommand(lastUser)) {
      return { block: `# Persistent memory\n${UNAVAILABLE_STATUS}`, note: 'Memory unavailable' }
    }
    return null
  }

  try {
    if (isMemoryListingRequest(lastUser)) {
      const listing = memories.slice(-LISTING_CAP)
      console.log(`[memory] listing request — ${listing.length} memories`)
      return {
        block:
          formatMemoryBlock(listing) +
          '\nThe user asked what you remember: answer from the list above (or say nothing is stored yet).',
        note: `Listed ${listing.length} memories`
      }
    }

    if (isExplicitMemoryCommand(lastUser)) {
      console.log('[memory] explicit command — running curator synchronously')
      const ops = await requestMemoryOps(history, memories)
      if (ops === null) {
        return {
          block: formatMemoryBlock(selectRelevantMemories(memories, history), UNAVAILABLE_STATUS),
          note: 'Memory command failed'
        }
      }
      const { applied, failed } = applyMemoryOps(ops)
      const status =
        applied.length === 0 && failed.length === 0
          ? 'No durable information was identified to store or forget — say so honestly if the user expected a change.'
          : [...applied.map((line) => `${line} — SUCCESS.`), ...failed].join(' ')
      const after = listMemories()
      console.log(`[memory] explicit command result: ${status}`)
      return {
        block: formatMemoryBlock(selectRelevantMemories(after, history), status),
        note: applied[0] ?? failed[0] ?? 'No memory change'
      }
    }

    const relevant = selectRelevantMemories(memories, history)
    if (relevant.length === 0) return null
    console.log(`[memory] injecting ${relevant.length} relevant memories`)
    return { block: formatMemoryBlock(relevant) }
  } catch (error) {
    console.error('[memory] context build failed', error)
    return null
  }
}

/**
 * Background extraction for implicit durable info ("I actually want detailed
 * answers now"). Fire-and-forget AFTER the reply: never blocks the response,
 * never throws, and skips turns with nothing memory-worthy.
 */
export async function runBackgroundExtraction(history: ChatTurn[]): Promise<void> {
  try {
    const lastUser = latestUserMessage(history)
    if (!lastUser || !isMemoryWorthy(lastUser)) return
    // Explicit commands and listing requests were already handled
    // synchronously this turn — don't run the curator twice.
    if (isExplicitMemoryCommand(lastUser) || isMemoryListingRequest(lastUser)) return
    const memories = listMemories()
    const ops = await requestMemoryOps(history, memories)
    if (!ops || ops.length === 0) return
    const { applied, failed } = applyMemoryOps(ops)
    if (applied.length > 0) console.log(`[memory] background: ${applied.join('; ')}`)
    if (failed.length > 0) console.error(`[memory] background failures: ${failed.join('; ')}`)
  } catch (error) {
    console.error('[memory] background extraction failed', error)
  }
}
