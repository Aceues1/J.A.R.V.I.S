import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GATE_SYSTEM_PROMPT, isTrivialMessage, runSearchGate } from '../gate'
import type { ChatTurn } from '../../chat-validation'

function gateReply(content: string): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ choices: [{ message: { content } }] })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const user = (content: string): ChatTurn => ({ role: 'user', content })
const assistant = (content: string): ChatTurn => ({ role: 'assistant', content })

beforeEach(() => {
  vi.stubEnv('GROQ_API_KEY', 'test-key')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('isTrivialMessage — local filter, no model call', () => {
  it.each([
    'hey',
    'Hey.',
    'hi',
    'Hello!',
    'yo',
    'ok',
    'Okay.',
    'thanks',
    'Thank you!',
    "that's cool",
    'cool',
    'nice',
    'lol',
    'haha',
    'yes',
    'no',
    'good morning',
    'Good evening, JARVIS.',
    'bye',
    'never mind',
    '   '
  ])('treats %j as trivial', (text) => {
    expect(isTrivialMessage(text)).toBe(true)
  })

  it.each([
    "What's the latest AI news?",
    'Search the web for iron man news',
    'Who won yesterday?',
    'What is Bitcoin at right now?',
    'Tell me a joke',
    "What's your opinion on this?",
    'ok so what happened with OpenAI today?'
  ])('does NOT treat %j as trivial', (text) => {
    expect(isTrivialMessage(text)).toBe(false)
  })
})

describe('runSearchGate', () => {
  it('skips the model entirely for trivial messages', async () => {
    const fetchMock = gateReply('{"search":true,"query":"should never be used"}')
    await expect(runSearchGate([user('Hey.')])).resolves.toEqual({ search: false })
    await expect(runSearchGate([user('ok')])).resolves.toEqual({ search: false })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('asks the gate model with recent history and returns its decision', async () => {
    const fetchMock = gateReply('{"search":true,"query":"OpenAI news today"}')
    const history = [
      user('Tell me about OpenAI.'),
      assistant('OpenAI is an AI research company, sir.'),
      user('What happened with them today?')
    ]
    const decision = await runSearchGate(history)
    expect(decision).toEqual({ search: true, query: 'OpenAI news today' })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.messages[0].content).toBe(GATE_SYSTEM_PROMPT)
    // The conversation rides along so the gate can resolve "them".
    expect(body.messages.map((m: { content: string }) => m.content)).toContain(
      'Tell me about OpenAI.'
    )
    expect(body.messages[body.messages.length - 1].content).toBe('What happened with them today?')
    expect(body.temperature).toBe(0)
  })

  it('returns search:false when the gate says no', async () => {
    gateReply('{"search":false}')
    await expect(runSearchGate([user('What is the capital of France?')])).resolves.toEqual({
      search: false
    })
  })

  it('accepts a fenced gate reply', async () => {
    gateReply('```json\n{"search":true,"query":"btc price"}\n```')
    await expect(runSearchGate([user('whats btc at')])).resolves.toEqual({
      search: true,
      query: 'btc price'
    })
  })

  it('fails CLOSED on gate errors — chat must survive a broken gate', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('down')))
    await expect(runSearchGate([user('latest AI news?')])).resolves.toEqual({ search: false })

    gateReply('sorry, I cannot decide that')
    await expect(runSearchGate([user('latest AI news?')])).resolves.toEqual({ search: false })

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({}) })
    )
    await expect(runSearchGate([user('latest AI news?')])).resolves.toEqual({ search: false })
  })

  it('fails CLOSED when no API key is configured', async () => {
    vi.stubEnv('GROQ_API_KEY', '')
    const fetchMock = gateReply('{"search":true,"query":"x"}')
    await expect(runSearchGate([user('latest AI news?')])).resolves.toEqual({ search: false })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uses the gate model override when set', async () => {
    vi.stubEnv('GROQ_GATE_MODEL', 'my-tiny-model')
    const fetchMock = gateReply('{"search":false}')
    await runSearchGate([user('latest AI news?')])
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).model).toBe('my-tiny-model')
  })
})
