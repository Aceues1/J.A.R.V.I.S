import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatMessage, PlayerDirective } from '@renderer/types/hud'

function createMessage(role: ChatMessage['role'], content: string): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    time: new Date().toLocaleTimeString([], { hour12: false })
  }
}

export interface ChatEvent {
  kind: 'sent' | 'received' | 'failed' | 'searched'
  detail: string
}

interface UseJarvisChatResult {
  messages: ChatMessage[]
  isLoading: boolean
  error: string | null
  /** Returns false when nothing was sent (blank text, or a request in flight). */
  sendMessage: (text: string) => boolean
  /** Append an assistant message locally (no backend call), e.g. the startup greeting. */
  addAssistantMessage: (text: string) => void
  retry: () => void
}

export function useJarvisChat(
  onEvent?: (event: ChatEvent) => void,
  onPlayer?: (directive: PlayerDirective) => void
): UseJarvisChatResult {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Refs so callers outside the render cycle (voice transcripts arriving via
  // IPC) always hit live state — the isLoading state value alone would make
  // sendMessage a stale closure that silently drops input.
  const messagesRef = useRef<ChatMessage[]>(messages)
  const loadingRef = useRef(false)
  const onEventRef = useRef(onEvent)
  const onPlayerRef = useRef(onPlayer)
  useEffect(() => {
    onEventRef.current = onEvent
    onPlayerRef.current = onPlayer
  }, [onEvent, onPlayer])

  const dispatch = useCallback(async (history: ChatMessage[]) => {
    loadingRef.current = true
    setError(null)
    setIsLoading(true)
    const startedAt = performance.now()

    try {
      const result = await window.jarvis.chat.sendMessage(
        history.map(({ role, content }) => ({ role, content }))
      )
      if (result.ok) {
        const reply = createMessage('assistant', result.message)
        messagesRef.current = [...messagesRef.current, reply]
        setMessages(messagesRef.current)
        // Surface live web searches in the diagnostics feed — the user can
        // see when an answer is grounded in a real search (and via what).
        if (result.search) {
          onEventRef.current?.({
            kind: 'searched',
            detail: result.search.ok
              ? `Web search: ${result.search.source} — "${result.search.query}"`
              : `Web search failed — "${result.search.query}"`
          })
        }
        onEventRef.current?.({
          kind: 'received',
          detail: `Response received in ${((performance.now() - startedAt) / 1000).toFixed(1)}s`
        })
        if (result.player) {
          onPlayerRef.current?.(result.player)
        }
      } else {
        setError(result.error)
        onEventRef.current?.({ kind: 'failed', detail: result.error })
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unexpected error contacting the AI backend.'
      setError(message)
      onEventRef.current?.({ kind: 'failed', detail: message })
    } finally {
      loadingRef.current = false
      setIsLoading(false)
    }
  }, [])

  const sendMessage = useCallback(
    (text: string): boolean => {
      const trimmed = text.trim()
      if (!trimmed || loadingRef.current) return false

      const userMessage = createMessage('user', trimmed)
      messagesRef.current = [...messagesRef.current, userMessage]
      setMessages(messagesRef.current)
      onEventRef.current?.({ kind: 'sent', detail: 'Request dispatched to AI backend' })
      void dispatch(messagesRef.current)
      return true
    },
    [dispatch]
  )

  const addAssistantMessage = useCallback((text: string) => {
    const message = createMessage('assistant', text)
    messagesRef.current = [...messagesRef.current, message]
    setMessages(messagesRef.current)
  }, [])

  const retry = useCallback(() => {
    if (loadingRef.current) return
    const history = messagesRef.current
    if (history.length === 0 || history[history.length - 1].role !== 'user') return
    onEventRef.current?.({ kind: 'sent', detail: 'Retrying last request' })
    void dispatch(history)
  }, [dispatch])

  return { messages, isLoading, error, sendMessage, addAssistantMessage, retry }
}
