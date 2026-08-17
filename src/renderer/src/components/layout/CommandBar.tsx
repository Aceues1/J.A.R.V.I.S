import { useState } from 'react'
import type { StatusLevel } from '@renderer/types/hud'
import { cn } from '@renderer/lib/cn'

interface CommandBarProps {
  status: StatusLevel
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  isLoading: boolean
}

export function CommandBar({
  status,
  value,
  onChange,
  onSubmit,
  isLoading
}: CommandBarProps): React.JSX.Element {
  const [micActive, setMicActive] = useState(false)
  const canSubmit = value.trim().length > 0 && !isLoading

  return (
    <div className="shrink-0 border-t border-cyan-dim/40 bg-void-deep/80 px-6 py-4">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (canSubmit) onSubmit()
        }}
        className="hud-panel flex items-center gap-3 px-3 py-2.5"
      >
        <span
          className={cn(
            'h-1.5 w-1.5 shrink-0 rounded-full bg-cyan',
            isLoading && 'animate-[var(--animate-blink)]'
          )}
        />

        <input
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={isLoading}
          placeholder="Ask Jarvis..."
          className="flex-1 bg-transparent font-sans text-base tracking-wide text-ink placeholder:text-ink-dim/70 focus:outline-none disabled:opacity-60"
        />

        <span className="hidden shrink-0 font-mono text-[10px] tracking-[0.15em] text-ink-dim sm:inline">
          {status.toUpperCase()}
        </span>

        <button
          type="button"
          aria-pressed={micActive}
          aria-label="Toggle microphone (voice integration coming in a later phase)"
          onClick={() => setMicActive((v) => !v)}
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center border transition-colors',
            micActive
              ? 'border-cyan-bright bg-cyan/15 text-cyan-bright'
              : 'border-cyan-dim/60 text-ink-dim hover:border-cyan/60 hover:text-cyan'
          )}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="6" y="1.5" width="4" height="8" rx="2" stroke="currentColor" />
            <path d="M3.5 8.5a4.5 4.5 0 0 0 9 0" stroke="currentColor" />
            <line x1="8" y1="13" x2="8" y2="14.5" stroke="currentColor" />
          </svg>
        </button>

        <button
          type="submit"
          aria-label="Send"
          disabled={!canSubmit}
          className="flex h-9 w-9 shrink-0 items-center justify-center border border-cyan/60 text-cyan transition-colors hover:bg-cyan/15 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M1.5 8h13M9 3l5.5 5-5.5 5"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </form>
      <p className="mt-1.5 px-1 font-mono text-[9px] tracking-[0.15em] text-ink-dim/70">
        VOICE INPUT/OUTPUT, TOOLS AND COMPUTER CONTROL ARRIVE IN A LATER PHASE
      </p>
    </div>
  )
}
