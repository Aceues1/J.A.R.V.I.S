import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '@renderer/types/hud'

function createMessage(role: ChatMessage['role'], content: string): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    time: new Date().toLocaleTimeString([], { hour12: false })
  }
}

export interface ChatEvent {
  kind: 'sent' | 'received' | 'failed'
  detail: string
}

interface UseJarvisChatResult {
  messages: ChatMessage[]
  isLoading: boolean
  error: string | null
  sendMessage: (text: string) => void
  retry: () => void
}

export function useJarvisChat(onEvent?: (event: ChatEvent) => void): UseJarvisChatResult {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Ref so retry/dispatch always see the latest transcript without re-creating callbacks.
  const messagesRef = useRef<ChatMessage[]>(messages)
  const onEventRef = useRef(onEvent)
  useEffect(() => {
    onEventRef.current = onEvent
  }, [onEvent])

  const dispatch = useCallback(async (history: ChatMessage[]) => {
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
        onEventRef.current?.({
          kind: 'received',
          detail: `Response received in ${((performance.now() - startedAt) / 1000).toFixed(1)}s`
        })
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
      setIsLoading(false)
    }
  }, [])

  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || isLoading) return

      const userMessage = createMessage('user', trimmed)
      messagesRef.current = [...messagesRef.current, userMessage]
      setMessages(messagesRef.current)
      onEventRef.current?.({ kind: 'sent', detail: 'Request dispatched to AI backend' })
      void dispatch(messagesRef.current)
    },
    [dispatch, isLoading]
  )

  const retry = useCallback(() => {
    if (isLoading) return
    const history = messagesRef.current
    if (history.length === 0 || history[history.length - 1].role !== 'user') return
    onEventRef.current?.({ kind: 'sent', detail: 'Retrying last request' })
    void dispatch(history)
  }, [dispatch, isLoading])

  return { messages, isLoading, error, sendMessage, retry }
}
