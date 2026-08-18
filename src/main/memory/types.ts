// PRO 4 persistent memory — shared types. The memory layer lives entirely in
// the main process: a small, local, durable store of long-term user
// information (preferences, facts, projects, decisions) that survives
// restarts. Designed so a future knowledge base can sit beside it (separate
// stores, same patterns) without replacing personal memory.

export type MemoryType = 'preference' | 'fact' | 'project' | 'decision'

export const MEMORY_TYPES: readonly MemoryType[] = ['preference', 'fact', 'project', 'decision']

export interface MemoryEntry {
  id: string
  type: MemoryType
  /** Concise third-person statement, e.g. "User prefers concise answers". */
  content: string
  /** 'explicit' = the user said "remember…"; 'inferred' = curator extracted. */
  source: 'explicit' | 'inferred'
  createdAt: string
  updatedAt: string
}

export class MemoryError extends Error {}

/** Hard limits that keep the store small, fast, and prompt-safe. */
export const MAX_MEMORIES = 200
export const MAX_CONTENT_CHARS = 300

export function isMemoryType(value: unknown): value is MemoryType {
  return typeof value === 'string' && (MEMORY_TYPES as string[]).includes(value)
}
