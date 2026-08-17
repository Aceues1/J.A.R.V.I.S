import { useCallback, useState } from 'react'
import type { ChatMessage } from '@renderer/types/hud'

function createId(): string {
  return crypto.randomUUID()
}

interface UseJarvisChatResult {
  messages: ChatMessage[]
  isLoading: boolean
  error: string | null
  sendMessage: (text: string) => Promise<void>
}

export function useJarvisChat(): UseJarvisChatResult {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || isLoading) return

      const userMessage: ChatMessage = { id: createId(), role: 'user', content: trimmed }
      const nextMessages = [...messages, userMessage]
      setMessages(nextMessages)
      setError(null)
      setIsLoading(true)

      try {
        const result = await window.jarvis.chat.sendMessage(
          nextMessages.map(({ role, content }) => ({ role, content }))
        )
        if (result.ok) {
          setMessages((prev) => [
            ...prev,
            { id: createId(), role: 'assistant', content: result.message }
          ])
        } else {
          setError(result.error)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unexpected error contacting the AI backend.')
      } finally {
        setIsLoading(false)
      }
    },
    [messages, isLoading]
  )

  return { messages, isLoading, error, sendMessage }
}
