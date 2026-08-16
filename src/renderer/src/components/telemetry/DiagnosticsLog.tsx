import type { LogEntry } from '@renderer/types/hud'
import { HudPanel } from '@renderer/components/hud/HudPanel'
import { cn } from '@renderer/lib/cn'

const levelColor: Record<LogEntry['level'], string> = {
  info: 'text-ink-dim',
  ok: 'text-good',
  warn: 'text-warn'
}

export function DiagnosticsLog({ entries }: { entries: LogEntry[] }): React.JSX.Element {
  return (
    <HudPanel title="Diagnostics Feed" eyebrow="Live" bodyClassName="py-2">
      <div className="max-h-40 space-y-1.5 overflow-y-auto font-mono text-[11px]">
        {entries.map((entry) => (
          <div key={entry.id} className="flex gap-3">
            <span className="text-ink-dim/70">{entry.time}</span>
            <span className={cn('uppercase', levelColor[entry.level])}>[{entry.level}]</span>
            <span className="text-ink-dim">{entry.message}</span>
          </div>
        ))}
      </div>
    </HudPanel>
  )
}
