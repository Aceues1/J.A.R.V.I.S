import { useEffect, useRef } from 'react'
import type { ChatMessage } from '@renderer/types/hud'
import { HudPanel } from '@renderer/components/hud/HudPanel'
import { cn } from '@renderer/lib/cn'

interface ConversationPanelProps {
  messages: ChatMessage[]
  isLoading: boolean
  error: string | null
}

export function ConversationPanel({
  messages,
  isLoading,
  error
}: ConversationPanelProps): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, isLoading])

  const isEmpty = messages.length === 0 && !isLoading && !error

  return (
    <HudPanel eyebrow="Transcript" title="Conversation" bodyClassName="py-3">
      {isEmpty ? (
        <p className="font-mono text-[11px] tracking-[0.15em] text-ink-dim">
          NO ACTIVE EXCHANGE — ASK JARVIS SOMETHING BELOW
        </p>
      ) : (
        <div ref={scrollRef} className="max-h-36 space-y-2.5 overflow-y-auto pr-1">
          {messages.map((message) => (
            <div key={message.id} className="font-mono text-[12px] leading-relaxed">
              <span
                className={cn(
                  'mr-2 tracking-[0.15em]',
                  message.role === 'user' ? 'text-ink-dim' : 'text-cyan'
                )}
              >
                {message.role === 'user' ? 'YOU //' : 'JARVIS //'}
              </span>
              <span className={message.role === 'user' ? 'text-ink-dim' : 'text-ink'}>
                {message.content}
              </span>
            </div>
          ))}

          {isLoading && (
            <div className="flex items-center gap-2 font-mono text-[12px]">
              <span className="tracking-[0.15em] text-cyan">JARVIS //</span>
              <span className="flex gap-1">
                <span className="h-1 w-1 animate-[var(--animate-blink)] rounded-full bg-cyan" />
                <span
                  className="h-1 w-1 animate-[var(--animate-blink)] rounded-full bg-cyan"
                  style={{ animationDelay: '0.2s' }}
                />
                <span
                  className="h-1 w-1 animate-[var(--animate-blink)] rounded-full bg-cyan"
                  style={{ animationDelay: '0.4s' }}
                />
              </span>
              <span className="text-ink-dim">thinking…</span>
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="mt-2 border-t border-alert/30 pt-2 font-mono text-[11px] text-alert">
          {error}
        </p>
      )}
    </HudPanel>
  )
}
