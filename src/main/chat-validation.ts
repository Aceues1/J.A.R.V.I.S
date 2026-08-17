export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

// The renderer sends the whole session transcript; rather than rejecting long
// sessions we keep the most recent window, so a chat never bricks itself.
export const MAX_HISTORY_LENGTH = 40
export const MAX_MESSAGE_LENGTH = 4000

export function validateChatHistory(payload: unknown): ChatTurn[] | null {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !Array.isArray((payload as { messages?: unknown }).messages)
  ) {
    return null
  }

  const messages = (payload as { messages: unknown[] }).messages
  if (messages.length === 0) {
    return null
  }

  const history: ChatTurn[] = []
  for (const entry of messages) {
    if (typeof entry !== 'object' || entry === null) return null
    const { role, content } = entry as { role?: unknown; content?: unknown }
    if (role !== 'user' && role !== 'assistant') return null
    if (typeof content !== 'string' || content.trim().length === 0) return null
    history.push({ role, content: content.slice(0, MAX_MESSAGE_LENGTH) })
  }

  return history.slice(-MAX_HISTORY_LENGTH)
}
