import { memo, useEffect, useRef } from 'react'
import type { LogEntry } from '@renderer/types/hud'
import { HudPanel } from '@renderer/components/hud/HudPanel'
import { cn } from '@renderer/lib/cn'

const levelColor: Record<LogEntry['level'], string> = {
  info: 'text-ink-dim',
  ok: 'text-good',
  warn: 'text-warn'
}

export const DiagnosticsLog = memo(function DiagnosticsLog({
  entries
}: {
  entries: LogEntry[]
}): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [entries])

  return (
    <HudPanel title="Diagnostics Feed" eyebrow="Live" bodyClassName="py-2">
      <div ref={scrollRef} className="max-h-40 space-y-1.5 overflow-y-auto font-mono text-[11px]">
        {entries.map((entry) => (
          <div key={entry.id} className="flex gap-3">
            <span className="shrink-0 text-ink-dim/70">{entry.time}</span>
            <span className={cn('shrink-0 uppercase', levelColor[entry.level])}>
              [{entry.level}]
            </span>
            <span className="min-w-0 truncate text-ink-dim" title={entry.message}>
              {entry.message}
            </span>
          </div>
        ))}
      </div>
    </HudPanel>
  )
})
