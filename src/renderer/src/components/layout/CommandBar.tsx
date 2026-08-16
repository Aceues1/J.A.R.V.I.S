import { useState } from 'react'
import type { StatusLevel } from '@renderer/types/hud'
import { cn } from '@renderer/lib/cn'

export function CommandBar({ status }: { status: StatusLevel }): React.JSX.Element {
  const [value, setValue] = useState('')
  const [micActive, setMicActive] = useState(false)

  return (
    <div className="shrink-0 border-t border-cyan-dim/40 bg-void-deep/80 px-6 py-4">
      <div className="hud-panel flex items-center gap-3 px-3 py-2.5">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-cyan animate-[var(--animate-blink)]" />

        <input
          type="text"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Ask Jarvis..."
          className="flex-1 bg-transparent font-sans text-base tracking-wide text-ink placeholder:text-ink-dim/70 focus:outline-none"
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
          type="button"
          aria-label="Send"
          className="flex h-9 w-9 shrink-0 items-center justify-center border border-cyan/60 text-cyan transition-colors hover:bg-cyan/15"
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
      </div>
      <p className="mt-1.5 px-1 font-mono text-[9px] tracking-[0.15em] text-ink-dim/70">
        VOICE, TOOLS AND LIVE RESPONSES ARRIVE IN A LATER PHASE — INTERFACE SHELL ONLY
      </p>
    </div>
  )
}
