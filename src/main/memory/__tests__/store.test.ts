import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addMemory, deleteMemory, listMemories, updateMemory } from '../store'
import { MemoryError, MAX_MEMORIES } from '../types'

let file: string

beforeEach(() => {
  file = join(mkdtempSync(join(tmpdir(), 'jarvis-mem-')), 'memory.json')
  vi.stubEnv('JARVIS_MEMORY_PATH', file)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('memory store', () => {
  it('creates a memory with full metadata and persists it durably', () => {
    const entry = addMemory({
      type: 'preference',
      content: 'User prefers concise answers',
      source: 'explicit'
    })
    expect(entry.id).toMatch(/^m-/)
    expect(entry.type).toBe('preference')
    expect(entry.createdAt).toBeTruthy()
    expect(entry.updatedAt).toBeTruthy()
    expect(entry.source).toBe('explicit')

    // Durable: visible in a fresh read of the file itself.
    const onDisk = JSON.parse(readFileSync(file, 'utf8'))
    expect(onDisk.memories[0].content).toBe('User prefers concise answers')
    expect(listMemories()).toHaveLength(1)
  })

  it('deduplicates by normalized content instead of storing twice', () => {
    const first = addMemory({
      type: 'fact',
      content: 'The project is called JARVIS.',
      source: 'explicit'
    })
    const second = addMemory({
      type: 'fact',
      content: '  the project is called  JARVIS ',
      source: 'inferred'
    })
    expect(second.id).toBe(first.id)
    expect(listMemories()).toHaveLength(1)
  })

  it('updates a memory in place, bumping updatedAt and keeping the id', () => {
    const entry = addMemory({
      type: 'preference',
      content: 'User prefers concise answers',
      source: 'explicit'
    })
    const updated = updateMemory(entry.id, 'User prefers detailed answers')
    expect(updated.id).toBe(entry.id)
    expect(updated.content).toBe('User prefers detailed answers')
    expect(listMemories()).toHaveLength(1)
    expect(listMemories()[0].content).toBe('User prefers detailed answers')
  })

  it('deletes a memory permanently', () => {
    const entry = addMemory({
      type: 'fact',
      content: "User's favorite color is teal",
      source: 'explicit'
    })
    deleteMemory(entry.id)
    expect(listMemories()).toHaveLength(0)
    expect(() => deleteMemory(entry.id)).toThrow(MemoryError)
  })

  it('refuses to store credential-like content', () => {
    for (const secret of [
      'my password is hunter2',
      'API key: sk-abcdef1234567890abcdef',
      'remember my token gsk_ZZZZaaaa1111222233334444',
      'AWS key AKIAABCDEFGHIJKLMNOP'
    ]) {
      expect(() => addMemory({ type: 'fact', content: secret, source: 'explicit' })).toThrow(
        /credential|secrets/i
      )
    }
    expect(listMemories()).toHaveLength(0)
    // updates are guarded too
    const entry = addMemory({ type: 'fact', content: 'User works at night', source: 'explicit' })
    expect(() => updateMemory(entry.id, 'password is hunter2')).toThrow(/credential|secrets/i)
  })

  it('rejects empty content and enforces the store cap', () => {
    expect(() => addMemory({ type: 'fact', content: '   ', source: 'explicit' })).toThrow(
      MemoryError
    )
    for (let i = 0; i < MAX_MEMORIES; i++) {
      addMemory({ type: 'fact', content: `fact number ${i}`, source: 'inferred' })
    }
    expect(() => addMemory({ type: 'fact', content: 'one too many', source: 'inferred' })).toThrow(
      'full'
    )
  })

  it('sets aside a corrupt store file and continues empty — never crashes', () => {
    writeFileSync(file, '{not valid json!!!')
    expect(listMemories()).toEqual([])
    // and the store is usable again immediately
    addMemory({ type: 'fact', content: 'recovered fine', source: 'inferred' })
    expect(listMemories()).toHaveLength(1)
  })

  it('drops malformed entries inside an otherwise valid file', () => {
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        memories: [
          {
            id: 'm-ok',
            type: 'preference',
            content: 'User prefers concise answers',
            source: 'explicit',
            createdAt: 'x',
            updatedAt: 'x'
          },
          { id: '', type: 'preference', content: 'no id' },
          { id: 'm-bad', type: 'not-a-type', content: 'bad type' },
          { id: 'm-empty', type: 'fact', content: '   ' },
          'not even an object'
        ]
      })
    )
    const memories = listMemories()
    expect(memories).toHaveLength(1)
    expect(memories[0].id).toBe('m-ok')
  })

  it('throws a clean MemoryError when the store was never initialized', () => {
    vi.stubEnv('JARVIS_MEMORY_PATH', '')
    expect(() => listMemories()).toThrow(MemoryError)
  })
})
