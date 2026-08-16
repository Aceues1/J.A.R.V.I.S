import { useEffect, useState } from 'react'
import { useClock } from '@renderer/hooks/useClock'

export function TitleBar(): React.JSX.Element {
  const [isMaximized, setIsMaximized] = useState(false)
  const now = useClock()

  useEffect(() => {
    window.jarvis.window.isMaximized().then(setIsMaximized)
    return window.jarvis.window.onStateChange(setIsMaximized)
  }, [])

  return (
    <div className="app-drag flex h-9 shrink-0 items-center justify-between border-b border-cyan-dim/40 bg-void-deep px-3">
      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-cyan animate-[var(--animate-blink)]" />
        <span className="font-display text-[11px] tracking-[0.3em] text-ink-dim">
          J.A.R.V.I.S <span className="text-cyan">{'// COMMAND INTERFACE'}</span>
        </span>
      </div>

      <div className="flex items-center gap-4">
        <span className="font-mono text-[10px] tracking-[0.15em] text-ink-dim">
          {now.toLocaleTimeString([], { hour12: false })}
        </span>
        <div className="no-drag flex items-center gap-1">
          <TitleBarButton label="minimize" onClick={() => window.jarvis.window.minimize()}>
            <svg width="10" height="10" viewBox="0 0 10 10">
              <line x1="1" y1="9" x2="9" y2="9" stroke="currentColor" strokeWidth="1" />
            </svg>
          </TitleBarButton>
          <TitleBarButton label="maximize" onClick={() => window.jarvis.window.maximizeToggle()}>
            <svg width="10" height="10" viewBox="0 0 10 10">
              <rect
                x="1"
                y={isMaximized ? 2 : 1}
                width="8"
                height="8"
                fill="none"
                stroke="currentColor"
                strokeWidth="1"
              />
            </svg>
          </TitleBarButton>
          <TitleBarButton
            label="close"
            variant="danger"
            onClick={() => window.jarvis.window.close()}
          >
            <svg width="10" height="10" viewBox="0 0 10 10">
              <line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" strokeWidth="1" />
              <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" strokeWidth="1" />
            </svg>
          </TitleBarButton>
        </div>
      </div>
    </div>
  )
}

function TitleBarButton({
  children,
  label,
  onClick,
  variant = 'default'
}: {
  children: React.ReactNode
  label: string
  onClick: () => void
  variant?: 'default' | 'danger'
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={
        variant === 'danger'
          ? 'flex h-6 w-8 items-center justify-center text-ink-dim transition-colors hover:bg-alert/20 hover:text-alert'
          : 'flex h-6 w-8 items-center justify-center text-ink-dim transition-colors hover:bg-cyan/10 hover:text-cyan'
      }
    >
      {children}
    </button>
  )
}
