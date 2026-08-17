import { memo, useEffect, useRef } from 'react'
import type { ChatMessage } from '@renderer/types/hud'
import { HudPanel } from '@renderer/components/hud/HudPanel'
import { cn } from '@renderer/lib/cn'

interface ConversationPanelProps {
  messages: ChatMessage[]
  isLoading: boolean
  error: string | null
  onRetry: () => void
  className?: string
}

export const ConversationPanel = memo(function ConversationPanel({
  messages,
  isLoading,
  error,
  onRetry,
  className
}: ConversationPanelProps): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, isLoading, error])

  const isEmpty = messages.length === 0 && !isLoading && !error

  return (
    <HudPanel
      eyebrow="Transcript"
      title="Conversation"
      className={cn('flex min-h-0 flex-col', className)}
      bodyClassName="flex min-h-0 flex-1 flex-col py-3"
    >
      {isEmpty ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="font-mono text-[11px] tracking-[0.2em] text-ink-dim">
            NO ACTIVE EXCHANGE — ASK JARVIS SOMETHING BELOW
          </p>
        </div>
      ) : (
        <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-2">
          {messages.map((message) => (
            <MessageBlock key={message.id} message={message} />
          ))}

          {isLoading && (
            <div className="animate-[var(--animate-rise)]">
              <p className="mb-1 font-mono text-[10px] tracking-[0.2em] text-cyan">
                JARVIS <span className="text-ink-dim/70">{'// PROCESSING'}</span>
              </p>
              <span className="flex gap-1.5 py-1" aria-label="JARVIS is thinking">
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
            </div>
          )}

          {error && (
            <div className="animate-[var(--animate-rise)] border-l-2 border-alert/60 pl-3">
              <p className="mb-1 font-mono text-[10px] tracking-[0.2em] text-alert">
                SYSTEM <span className="text-ink-dim/70">{'// ERROR'}</span>
              </p>
              <p className="font-mono text-[12px] leading-relaxed text-alert/90">{error}</p>
              <button
                type="button"
                onClick={onRetry}
                className="mt-1.5 border border-alert/50 px-2.5 py-1 font-mono text-[10px] tracking-[0.2em] text-alert transition-colors hover:bg-alert/10"
              >
                RETRY
              </button>
            </div>
          )}
        </div>
      )}
    </HudPanel>
  )
})

function MessageBlock({ message }: { message: ChatMessage }): React.JSX.Element {
  const isUser = message.role === 'user'
  return (
    <div className="animate-[var(--animate-rise)]">
      <p className="mb-1 font-mono text-[10px] tracking-[0.2em]">
        <span className={isUser ? 'text-ink-dim' : 'text-cyan'}>{isUser ? 'YOU' : 'JARVIS'}</span>
        <span className="ml-2 text-ink-dim/50">{message.time}</span>
      </p>
      <p
        className={cn(
          'font-sans text-sm leading-relaxed whitespace-pre-wrap',
          isUser ? 'text-ink-dim' : 'text-ink'
        )}
      >
        {message.content}
      </p>
    </div>
  )
}
