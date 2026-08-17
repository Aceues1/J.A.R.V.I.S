import { describe, expect, it } from 'vitest'
import { MAX_HISTORY_LENGTH, MAX_MESSAGE_LENGTH, validateChatHistory } from '../chat-validation'

const turn = (role: 'user' | 'assistant', content = 'hello'): object => ({ role, content })

describe('validateChatHistory', () => {
  it('accepts a well-formed history', () => {
    const result = validateChatHistory({
      messages: [turn('user'), turn('assistant'), turn('user')]
    })
    expect(result).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hello' },
      { role: 'user', content: 'hello' }
    ])
  })

  it.each([
    ['null payload', null],
    ['missing messages', {}],
    ['non-array messages', { messages: 'nope' }],
    ['empty history', { messages: [] }],
    ['bad role', { messages: [{ role: 'system', content: 'x' }] }],
    ['non-string content', { messages: [{ role: 'user', content: 42 }] }],
    ['blank content', { messages: [{ role: 'user', content: '   ' }] }],
    ['null entry', { messages: [null] }]
  ])('rejects %s', (_label, payload) => {
    expect(validateChatHistory(payload)).toBeNull()
  })

  it('keeps only the most recent window of a long conversation instead of rejecting it', () => {
    const messages = Array.from({ length: MAX_HISTORY_LENGTH + 10 }, (_, i) =>
      turn(i % 2 === 0 ? 'user' : 'assistant', `message ${i}`)
    )
    const result = validateChatHistory({ messages })
    expect(result).toHaveLength(MAX_HISTORY_LENGTH)
    expect(result?.at(-1)).toEqual({
      role: 'assistant',
      content: `message ${MAX_HISTORY_LENGTH + 9}`
    })
  })

  it('truncates oversized message content instead of rejecting it', () => {
    const result = validateChatHistory({
      messages: [turn('user', 'x'.repeat(MAX_MESSAGE_LENGTH + 500))]
    })
    expect(result).toHaveLength(1)
    expect(result?.[0].content).toHaveLength(MAX_MESSAGE_LENGTH)
  })
})
