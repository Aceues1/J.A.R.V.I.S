import type { ReactNode } from 'react'
import { cn } from '@renderer/lib/cn'

interface HudPanelProps {
  title?: string
  eyebrow?: string
  right?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}

export function HudPanel({
  title,
  eyebrow,
  right,
  children,
  className,
  bodyClassName
}: HudPanelProps): React.JSX.Element {
  return (
    <section className={cn('hud-panel relative animate-[var(--animate-rise)]', className)}>
      <Corner position="top-left" />
      <Corner position="top-right" />
      <Corner position="bottom-left" />
      <Corner position="bottom-right" />

      {(title || right) && (
        <header className="flex items-center justify-between border-b border-cyan-dim/40 px-4 py-2.5">
          <div>
            {eyebrow && (
              <p className="font-mono text-[10px] tracking-[0.25em] text-ink-dim uppercase">
                {eyebrow}
              </p>
            )}
            {title && (
              <h2 className="font-display text-xs tracking-[0.18em] text-cyan uppercase">
                {title}
              </h2>
            )}
          </div>
          {right}
        </header>
      )}

      <div className={cn('px-4 py-3', bodyClassName)}>{children}</div>
    </section>
  )
}

function Corner({
  position
}: {
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
}): React.JSX.Element {
  const base = 'pointer-events-none absolute h-2.5 w-2.5 border-cyan/70'
  const styles: Record<typeof position, string> = {
    'top-left': 'top-0 left-0 border-t border-l',
    'top-right': 'top-0 right-0 border-t border-r',
    'bottom-left': 'bottom-0 left-0 border-b border-l',
    'bottom-right': 'bottom-0 right-0 border-b border-r'
  }
  return <span className={cn(base, styles[position])} />
}
