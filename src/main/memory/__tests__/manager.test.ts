import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyMemoryOps, getMemoryTurnContext, runBackgroundExtraction } from '../index'
import { addMemory, listMemories } from '../store'
import type { ChatTurn } from '../../chat-validation'

const user = (content: string): ChatTurn => ({ role: 'user', content })

function curatorReply(content: string): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ choices: [{ message: { content } }] })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  vi.stubEnv('GROQ_API_KEY', 'test-key')
  vi.stubEnv('JARVIS_MEMORY_PATH', join(mkdtempSync(join(tmpdir(), 'jarvis-mgr-')), 'memory.json'))
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('getMemoryTurnContext', () => {
  it('returns null for ordinary turns with no stored memories — no model call', async () => {
    const fetchMock = curatorReply('{"ops":[]}')
    await expect(getMemoryTurnContext([user('tell me a joke')])).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('injects relevant memories for ordinary turns', async () => {
    addMemory({ type: 'fact', content: "User's favorite color is teal", source: 'explicit' })
    const context = await getMemoryTurnContext([user('what is my favorite color?')])
    expect(context?.block).toContain("User's favorite color is teal")
    expect(context?.block).toContain('# Persistent memory')
  })

  it('answers listing requests from the full store', async () => {
    addMemory({ type: 'preference', content: 'User prefers concise answers', source: 'explicit' })
    addMemory({ type: 'project', content: 'The project is called JARVIS', source: 'explicit' })
    const context = await getMemoryTurnContext([user('What do you remember about me?')])
    expect(context?.block).toContain('User prefers concise answers')
    expect(context?.block).toContain('The project is called JARVIS')
    expect(context?.note).toBe('Listed 2 memories')
  })

  it('executes an explicit remember command synchronously with an honest SUCCESS status', async () => {
    curatorReply(
      '{"ops":[{"op":"add","type":"preference","content":"User prefers concise answers"}]}'
    )
    const context = await getMemoryTurnContext([user('Remember that I prefer concise answers.')])
    expect(context?.block).toContain(
      'Stored [preference] "User prefers concise answers" — SUCCESS.'
    )
    expect(context?.note).toContain('Stored [preference]')
    expect(listMemories()).toHaveLength(1) // actually persisted before the reply
  })

  it('resolves contradictions as an UPDATE of the conflicting memory, not a duplicate', async () => {
    const entry = addMemory({
      type: 'preference',
      content: 'User prefers concise answers',
      source: 'explicit'
    })
    curatorReply(
      `{"ops":[{"op":"update","id":"${entry.id}","content":"User prefers detailed answers"}]}`
    )
    const context = await getMemoryTurnContext([user('Remember that I want detailed answers now.')])
    expect(context?.block).toContain('SUCCESS')
    const memories = listMemories()
    expect(memories).toHaveLength(1)
    expect(memories[0].content).toBe('User prefers detailed answers')
    expect(memories[0].id).toBe(entry.id)
  })

  it('executes an explicit forget command and reports the real deletion', async () => {
    const entry = addMemory({
      type: 'fact',
      content: "User's favorite color is teal",
      source: 'explicit'
    })
    curatorReply(`{"ops":[{"op":"delete","id":"${entry.id}"}]}`)
    const context = await getMemoryTurnContext([user('Forget my favorite color.')])
    expect(context?.block).toContain('Deleted memory')
    expect(context?.block).toContain('SUCCESS')
    expect(listMemories()).toHaveLength(0)
  })

  it('reports honestly when the curator call fails — nothing stored, no false claims', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('down')))
    const context = await getMemoryTurnContext([user('Remember that I prefer concise answers.')])
    expect(context?.block).toContain('temporarily unavailable')
    expect(context?.block).toContain('do not claim success')
    expect(listMemories()).toHaveLength(0)
  })

  it('says memory is unavailable (only when asked about memory) if the store is broken', async () => {
    vi.stubEnv('JARVIS_MEMORY_PATH', '') // uninitialized store
    const asked = await getMemoryTurnContext([user('What do you remember about me?')])
    expect(asked?.block).toContain('temporarily unavailable')

    // Ordinary chat continues silently without memory.
    await expect(getMemoryTurnContext([user('tell me a joke')])).resolves.toBeNull()
  })
})

describe('applyMemoryOps failure isolation', () => {
  it('a failing op never blocks the others, and failures are reported', () => {
    const { applied, failed } = applyMemoryOps([
      { op: 'delete', id: 'm-does-not-exist' },
      { op: 'add', type: 'fact', content: 'User lives in Norway' }
    ])
    expect(failed).toHaveLength(1)
    expect(failed[0]).toContain('DELETE FAILED')
    expect(applied).toHaveLength(1)
    expect(listMemories()).toHaveLength(1)
  })

  it('secret-like content is refused at apply time and surfaces as a failure', () => {
    const { applied, failed } = applyMemoryOps([
      { op: 'add', type: 'fact', content: 'my api key is sk-abcdef1234567890abcdef' }
    ])
    expect(applied).toHaveLength(0)
    expect(failed[0]).toMatch(/credential|secrets/i)
    expect(listMemories()).toHaveLength(0)
  })
})

describe('runBackgroundExtraction', () => {
  it('skips unworthy turns without any model call', async () => {
    const fetchMock = curatorReply('{"ops":[]}')
    await runBackgroundExtraction([user('open youtube')])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('skips explicit commands — they were already handled synchronously', async () => {
    const fetchMock = curatorReply('{"ops":[]}')
    await runBackgroundExtraction([user('Remember that I prefer concise answers.')])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('stores implicit durable info in the background', async () => {
    curatorReply(
      '{"ops":[{"op":"add","type":"preference","content":"User wants to be called Chris"}]}'
    )
    await runBackgroundExtraction([user('Call me Chris from now on.')])
    expect(listMemories()).toHaveLength(1)
    expect(listMemories()[0].content).toBe('User wants to be called Chris')
  })

  it('never throws — extraction failure leaves chat untouched', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('down')))
    await expect(
      runBackgroundExtraction([user('I prefer detailed answers now.')])
    ).resolves.toBeUndefined()
    expect(listMemories()).toHaveLength(0)
  })
})
