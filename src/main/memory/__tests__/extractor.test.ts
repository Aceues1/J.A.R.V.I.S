import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CURATOR_SYSTEM_PROMPT,
  isExplicitMemoryCommand,
  isMemoryListingRequest,
  isMemoryWorthy,
  parseCuratorReply,
  requestMemoryOps
} from '../extractor'
import type { MemoryEntry } from '../types'

const existing: MemoryEntry[] = [
  {
    id: 'm-concise',
    type: 'preference',
    content: 'User prefers concise answers',
    source: 'explicit',
    createdAt: 'x',
    updatedAt: 'x'
  }
]

beforeEach(() => {
  vi.stubEnv('GROQ_API_KEY', 'test-key')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('classification prescreens', () => {
  it.each([
    'Remember that I prefer concise answers.',
    'I actually want detailed answers now.',
    "Don't call me sir.",
    'My name is Christian.',
    'We are building JARVIS together.',
    'I decided to go with Electron.',
    'My favorite color is teal.',
    'From now on, keep replies short.'
  ])('flags %j as memory-worthy', (text) => {
    expect(isMemoryWorthy(text)).toBe(true)
  })

  it.each([
    "What's the weather?",
    'Open YouTube.',
    'Thanks.',
    'Play a video about iron man',
    'Analyze my screen',
    'What is the capital of France?'
  ])('does NOT flag %j as memory-worthy', (text) => {
    expect(isMemoryWorthy(text)).toBe(false)
  })

  it.each([
    'Remember that I prefer concise answers.',
    'Remember this.',
    "Don't remember that.",
    'Forget what you know about my project.',
    'Forget that preference.'
  ])('treats %j as an explicit memory command', (text) => {
    expect(isExplicitMemoryCommand(text)).toBe(true)
  })

  it.each(['What do you remember about me?', 'Show me what you remember', 'List your memories'])(
    'treats %j as a listing request',
    (text) => {
      expect(isMemoryListingRequest(text)).toBe(true)
    }
  )

  it('ordinary conversation is neither a command nor a listing request', () => {
    for (const text of ['Tell me a joke', "What's Bitcoin at right now?", 'Good evening']) {
      expect(isExplicitMemoryCommand(text)).toBe(false)
      expect(isMemoryListingRequest(text)).toBe(false)
    }
  })
})

describe('parseCuratorReply — strict op validation', () => {
  it('accepts valid add/update/delete ops', () => {
    const ops = parseCuratorReply(
      '{"ops":[{"op":"add","type":"fact","content":"User lives in Norway"},' +
        '{"op":"update","id":"m-concise","content":"User prefers detailed answers"},' +
        '{"op":"delete","id":"m-concise"}]}',
      existing
    )
    expect(ops).toEqual([
      { op: 'add', type: 'fact', content: 'User lives in Norway' },
      { op: 'update', id: 'm-concise', content: 'User prefers detailed answers' },
      { op: 'delete', id: 'm-concise' }
    ])
  })

  it('drops invalid ops: unknown types, unknown ids, empty content, junk shapes', () => {
    const ops = parseCuratorReply(
      '{"ops":[{"op":"add","type":"password","content":"x"},' +
        '{"op":"update","id":"m-ghost","content":"y"},' +
        '{"op":"delete","id":"m-ghost"},' +
        '{"op":"add","type":"fact","content":""},' +
        '{"op":"exec","cmd":"rm -rf"},"garbage"]}',
      existing
    )
    expect(ops).toEqual([])
  })

  it('caps the number of ops per turn', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      op: 'add',
      type: 'fact',
      content: `fact ${i}`
    }))
    expect(parseCuratorReply(JSON.stringify({ ops: many }), existing).length).toBeLessThanOrEqual(4)
  })

  it('tolerates fenced or prose-wrapped replies and rejects non-JSON', () => {
    expect(
      parseCuratorReply('```json\n{"ops":[{"op":"delete","id":"m-concise"}]}\n```', existing)
    ).toEqual([{ op: 'delete', id: 'm-concise' }])
    expect(parseCuratorReply('I cannot decide.', existing)).toEqual([])
  })
})

describe('requestMemoryOps', () => {
  function curatorReply(content: string): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ choices: [{ message: { content } }] })
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('sends the curator prompt with existing memories, low reasoning, real token headroom', async () => {
    const fetchMock = curatorReply('{"ops":[]}')
    const ops = await requestMemoryOps(
      [{ role: 'user', content: 'Remember that I prefer concise answers.' }],
      existing
    )
    expect(ops).toEqual([])
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.messages[0].content).toBe(CURATOR_SYSTEM_PROMPT)
    expect(body.messages[1].content).toContain(
      '[m-concise] [preference] User prefers concise answers'
    )
    expect(body.max_tokens).toBeGreaterThanOrEqual(512) // the PRO 3 gate lesson
    expect(body.reasoning_effort).toBe('low')
    // gpt-oss phantom tool-call guard (the PRO 5 Windows report)
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(CURATOR_SYSTEM_PROMPT).toMatch(/never emit a tool or function call/i)
  })

  it('retries once with the main chat model when the curator model is rejected (4xx)', async () => {
    vi.stubEnv('GROQ_MODEL', 'main-chat-model')
    const fetchMock = vi.fn(async (_url: unknown, init: { body?: string } = {}) => {
      const model = init.body ? (JSON.parse(init.body).model as string) : ''
      if (model === 'main-chat-model') {
        return {
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              choices: [
                {
                  message: {
                    content: '{"ops":[{"op":"add","type":"fact","content":"User lives in Norway"}]}'
                  }
                }
              ]
            })
        }
      }
      return {
        ok: false,
        status: 400,
        text: () => Promise.resolve('Tool choice is none, but model called a tool'),
        json: () => Promise.resolve({})
      }
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      requestMemoryOps([{ role: 'user', content: 'Remember that I live in Norway' }], [])
    ).resolves.toEqual([{ op: 'add', type: 'fact', content: 'User lives in Norway' }])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('returns null (not []) on extraction failure so callers can be honest', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('down')))
    await expect(
      requestMemoryOps([{ role: 'user', content: 'Remember X' }], [])
    ).resolves.toBeNull()

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({}) })
    )
    await expect(
      requestMemoryOps([{ role: 'user', content: 'Remember X' }], [])
    ).resolves.toBeNull()

    vi.stubEnv('GROQ_API_KEY', '')
    await expect(
      requestMemoryOps([{ role: 'user', content: 'Remember X' }], [])
    ).resolves.toBeNull()
  })

  it('recovers ops from message.reasoning when content is empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            choices: [
              {
                message: {
                  content: '',
                  reasoning:
                    'Storing it. {"ops":[{"op":"add","type":"fact","content":"User lives in Norway"}]}'
                }
              }
            ]
          })
      })
    )
    await expect(
      requestMemoryOps([{ role: 'user', content: 'I live in Norway' }], [])
    ).resolves.toEqual([{ op: 'add', type: 'fact', content: 'User lives in Norway' }])
  })
})
