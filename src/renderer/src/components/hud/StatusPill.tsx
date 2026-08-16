import type { StatusLevel } from '@renderer/types/hud'
import { cn } from '@renderer/lib/cn'

const statusConfig: Record<StatusLevel, { label: string; dot: string; text: string }> = {
  online: { label: 'ONLINE', dot: 'bg-good', text: 'text-good' },
  standby: { label: 'STANDBY', dot: 'bg-cyan', text: 'text-cyan' },
  listening: { label: 'LISTENING', dot: 'bg-cyan-bright', text: 'text-cyan-bright' },
  processing: { label: 'PROCESSING', dot: 'bg-warn', text: 'text-warn' },
  alert: { label: 'ALERT', dot: 'bg-alert', text: 'text-alert' }
}

export function StatusPill({ status }: { status: StatusLevel }): React.JSX.Element {
  const config = statusConfig[status]
  return (
    <span className="inline-flex items-center gap-2 border border-cyan-dim/60 px-2.5 py-1 font-mono text-[10px] tracking-[0.2em]">
      <span className={cn('h-1.5 w-1.5 rounded-full animate-[var(--animate-blink)]', config.dot)} />
      <span className={config.text}>{config.label}</span>
    </span>
  )
}
