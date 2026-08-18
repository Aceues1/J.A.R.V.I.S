// Durable local memory store: a small JSON file in the Electron userData
// directory (JARVIS_MEMORY_PATH overrides for tests). Writes are atomic
// (temp file + rename) so a crash can't corrupt the store; a corrupt file is
// set aside rather than crashing or silently deleting user data. Everything
// is synchronous — the file is tiny and lives on the main process.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { randomUUID } from 'crypto'
import {
  MAX_CONTENT_CHARS,
  MAX_MEMORIES,
  MemoryError,
  isMemoryType,
  type MemoryEntry,
  type MemoryType
} from './types'
import { looksLikeSecret } from './secrets'

interface MemoryFile {
  version: 1
  memories: MemoryEntry[]
}

let registeredPath: string | null = null

/** Called once at startup with the Electron userData directory. */
export function registerMemoryDir(dir: string): void {
  registeredPath = join(dir, 'jarvis-memory.json')
}

function resolvePath(): string {
  const path = process.env.JARVIS_MEMORY_PATH || registeredPath
  if (!path) {
    throw new MemoryError('The memory store is not initialized.')
  }
  return path
}

function sanitizeEntry(raw: unknown): MemoryEntry | null {
  const entry = raw as Partial<MemoryEntry> | null
  if (!entry || typeof entry !== 'object') return null
  if (typeof entry.id !== 'string' || !entry.id) return null
  if (!isMemoryType(entry.type)) return null
  if (typeof entry.content !== 'string' || !entry.content.trim()) return null
  return {
    id: entry.id,
    type: entry.type,
    content: entry.content.slice(0, MAX_CONTENT_CHARS),
    source: entry.source === 'explicit' ? 'explicit' : 'inferred',
    createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : new Date().toISOString(),
    updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : new Date().toISOString()
  }
}

function readFile(): MemoryFile {
  const path = resolvePath()
  if (!existsSync(path)) {
    return { version: 1, memories: [] }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    // Corrupt store: set it aside (never silently discard user data, never
    // crash) and start fresh.
    console.error('[memory] store file is corrupt — setting it aside', error)
    try {
      renameSync(path, `${path}.corrupt-${Date.now()}`)
    } catch {
      // rename is best-effort
    }
    return { version: 1, memories: [] }
  }
  const memories = (parsed as { memories?: unknown[] })?.memories
  if (!Array.isArray(memories)) {
    console.error('[memory] store file has an unexpected shape — treating as empty')
    return { version: 1, memories: [] }
  }
  return {
    version: 1,
    memories: memories.map(sanitizeEntry).filter((entry): entry is MemoryEntry => entry !== null)
  }
}

function writeFileAtomic(file: MemoryFile): void {
  const path = resolvePath()
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}`
  writeFileSync(tmp, JSON.stringify(file, null, 2), 'utf8')
  renameSync(tmp, path)
}

function normalize(content: string): string {
  return content
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.!]+$/, '')
}

/** All stored memories (sanitized). Throws MemoryError only on init issues. */
export function listMemories(): MemoryEntry[] {
  return readFile().memories
}

export interface AddMemoryInput {
  type: MemoryType
  content: string
  source: 'explicit' | 'inferred'
}

/**
 * Store a new memory. Refuses secrets, dedupes on normalized content
 * (returning the existing entry), enforces the store cap.
 */
export function addMemory(input: AddMemoryInput): MemoryEntry {
  const content = input.content.trim().slice(0, MAX_CONTENT_CHARS)
  if (!content) {
    throw new MemoryError('Cannot store an empty memory.')
  }
  if (looksLikeSecret(content)) {
    throw new MemoryError('That looks like a credential — I never store secrets.')
  }
  const file = readFile()
  const existing = file.memories.find((entry) => normalize(entry.content) === normalize(content))
  if (existing) {
    return existing
  }
  if (file.memories.length >= MAX_MEMORIES) {
    throw new MemoryError('The memory store is full.')
  }
  const now = new Date().toISOString()
  const entry: MemoryEntry = {
    id: `m-${randomUUID().slice(0, 8)}`,
    type: input.type,
    content,
    source: input.source,
    createdAt: now,
    updatedAt: now
  }
  file.memories.push(entry)
  writeFileAtomic(file)
  return entry
}

/** Replace a memory's content (preference change, correction, refinement). */
export function updateMemory(id: string, content: string): MemoryEntry {
  const trimmed = content.trim().slice(0, MAX_CONTENT_CHARS)
  if (!trimmed) {
    throw new MemoryError('Cannot update a memory to empty content.')
  }
  if (looksLikeSecret(trimmed)) {
    throw new MemoryError('That looks like a credential — I never store secrets.')
  }
  const file = readFile()
  const entry = file.memories.find((candidate) => candidate.id === id)
  if (!entry) {
    throw new MemoryError(`No memory with id ${id}.`)
  }
  entry.content = trimmed
  entry.updatedAt = new Date().toISOString()
  writeFileAtomic(file)
  return entry
}

/** Permanently delete one memory. */
export function deleteMemory(id: string): MemoryEntry {
  const file = readFile()
  const index = file.memories.findIndex((candidate) => candidate.id === id)
  if (index === -1) {
    throw new MemoryError(`No memory with id ${id}.`)
  }
  const [removed] = file.memories.splice(index, 1)
  writeFileAtomic(file)
  return removed
}
