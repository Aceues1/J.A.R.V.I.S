import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GATE_SYSTEM_PROMPT,
  isTrivialMessage,
  resetGateModelStickiness,
  runSearchGate
} from '../gate'
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
  resetGateModelStickiness()
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

  // REGRESSION (Windows PRO 3 bug): gpt-oss gate models are reasoning models —
  // max_tokens caps reasoning + answer combined. A tight cap (120) starved the
  // reasoning channel, returned EMPTY content, and silently failed every gate
  // closed, so no live search ever ran. Pin the headroom and the low effort.
  it('gives the reasoning gate model real token headroom and low reasoning effort', async () => {
    const fetchMock = gateReply('{"search":true,"query":"latest AI news"}')
    await runSearchGate([user('latest AI news?')])
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.max_tokens).toBeGreaterThanOrEqual(512)
    expect(body.reasoning_effort).toBe('low')
  })

  // REGRESSION (Windows PRO 5 report): gpt-oss models emit phantom built-in
  // tool calls ("Tool choice is none, but model called a tool"). json_object
  // mode pins output to the JSON channel, and the prompt forbids tool calls.
  it('forces json_object output and forbids tool calls for gpt-oss gate models', async () => {
    const fetchMock = gateReply('{"search":false}')
    await runSearchGate([user('latest AI news?')])
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(GATE_SYSTEM_PROMPT).toMatch(/never emit a tool or function call/i)
  })

  it('omits reasoning_effort and response_format for non-gpt-oss override models', async () => {
    vi.stubEnv('GROQ_GATE_MODEL', 'llama-x-8b')
    const fetchMock = gateReply('{"search":false}')
    await runSearchGate([user('latest AI news?')])
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect('reasoning_effort' in body).toBe(false)
    expect('response_format' in body).toBe(false)
  })

  it('makes the fallback model sticky after repeated 4xx — one call per turn again', async () => {
    vi.stubEnv('GROQ_MODEL', 'main-chat-model')
    const fetchMock = vi.fn(async (_url: unknown, init: { body?: string } = {}) => {
      const model = init.body ? (JSON.parse(init.body).model as string) : ''
      if (model === 'main-chat-model') {
        return {
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              choices: [{ message: { content: '{"search":true,"query":"latest AI news"}' } }]
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

    // Turns 1 and 2: primary fails, fallback succeeds (2 calls each).
    await runSearchGate([user('latest AI news?')])
    await runSearchGate([user('latest AI news?')])
    expect(fetchMock).toHaveBeenCalledTimes(4)

    // Turn 3+: sticky — the fallback is called directly (1 call per turn).
    const decision = await runSearchGate([user('latest AI news?')])
    expect(decision).toEqual({ search: true, query: 'latest AI news' })
    expect(fetchMock).toHaveBeenCalledTimes(5)
    expect(JSON.parse(fetchMock.mock.calls[4][1]!.body!).model).toBe('main-chat-model')
  })

  it('recovers the decision from message.reasoning when content is empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            choices: [
              {
                finish_reason: 'length',
                message: {
                  content: '',
                  reasoning: 'The user wants news. {"search":true,"query":"latest AI news"}'
                }
              }
            ]
          })
      })
    )
    await expect(runSearchGate([user('latest AI news?')])).resolves.toEqual({
      search: true,
      query: 'latest AI news'
    })
  })

  it('retries once with the main chat model when the gate model is rejected (4xx)', async () => {
    vi.stubEnv('GROQ_MODEL', 'main-chat-model')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: () => Promise.resolve('model_decommissioned'),
        json: () => Promise.resolve({})
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: '{"search":true,"query":"latest AI news"}' } }]
          })
      })
    vi.stubGlobal('fetch', fetchMock)

    await expect(runSearchGate([user('latest AI news?')])).resolves.toEqual({
      search: true,
      query: 'latest AI news'
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).model).toBe('main-chat-model')
  })

  it('does not retry on server errors (5xx) — fails closed instead', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: () => Promise.resolve('overloaded'),
      json: () => Promise.resolve({})
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(runSearchGate([user('latest AI news?')])).resolves.toEqual({ search: false })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('json_validate_failed recovery', () => {
  function jsonValidateFailed(failedGeneration: string): object {
    return {
      ok: false,
      status: 400,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            error: {
              code: 'json_validate_failed',
              message: 'Failed to validate JSON. Please adjust your prompt.',
              failed_generation: failedGeneration
            }
          })
        ),
      json: () => Promise.reject(new Error('unused'))
    }
  }

  function fetchQueue(responses: object[]): ReturnType<typeof vi.fn> {
    const queue = [...responses]
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(queue.length > 1 ? queue.shift() : queue[0]))
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  const ok = (content: string): object => ({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ choices: [{ message: { content } }] })
  })

  it('recovers the decision from failed_generation without any retry', async () => {
    const fetchMock = fetchQueue([
      jsonValidateFailed('{"search":true,"query":"latest OpenAI news"}')
    ])
    await expect(runSearchGate([user('any OpenAI news today?')])).resolves.toEqual({
      search: true,
      query: 'latest OpenAI news'
    })
    expect(fetchMock).toHaveBeenCalledTimes(1) // no 120b fallback call
  })

  it('recovers from a fenced/dirty failed_generation via the lenient parser', async () => {
    fetchQueue([jsonValidateFailed('```json\n{"search":false}\n```')])
    await expect(runSearchGate([user('is water wet, technically?')])).resolves.toEqual({
      search: false
    })
  })

  it('fails closed without fallback when failed_generation is unusable', async () => {
    const fetchMock = fetchQueue([jsonValidateFailed('total garbage, no json here')])
    await expect(runSearchGate([user('what is bitcoin at right now?')])).resolves.toEqual({
      search: false
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('never counts validation hiccups toward stickiness — gate model survives', async () => {
    const fetchMock = fetchQueue([
      jsonValidateFailed('garbage'),
      jsonValidateFailed('garbage'),
      ok('{"search":false}')
    ])
    await runSearchGate([user('price of ethereum right now?')])
    await runSearchGate([user('latest nvidia news?')])
    // Two validation failures must NOT pin the session to the 120b fallback.
    await runSearchGate([user('who won the match yesterday?')])
    const thirdBody = JSON.parse(fetchMock.mock.calls[2][1].body)
    expect(thirdBody.model).toBe('openai/gpt-oss-20b')
  })

  it('sends the 1024-token gate budget', async () => {
    const fetchMock = gateReply('{"search":false}')
    await runSearchGate([user('what is the capital of France, currently?')])
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.max_tokens).toBe(1024)
  })
})
