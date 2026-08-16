import type { StatusLevel } from '@renderer/types/hud'
import { StatusPill } from '@renderer/components/hud/StatusPill'

export function IdentityBlock({ status }: { status: StatusLevel }): React.JSX.Element {
  return (
    <div className="border-b border-cyan-dim/40 px-4 py-5">
      <div className="flex items-center gap-3">
        <div className="relative flex h-10 w-10 items-center justify-center border border-cyan/50">
          <span className="absolute inset-0 animate-[var(--animate-core-pulse)] bg-cyan/10" />
          <span className="font-display text-sm text-cyan">J</span>
        </div>
        <div>
          <p className="font-display text-sm tracking-[0.2em] text-ink">JARVIS</p>
          <p className="font-mono text-[10px] tracking-[0.15em] text-ink-dim">PERSONAL AI SYSTEM</p>
        </div>
      </div>
      <div className="mt-4">
        <StatusPill status={status} />
      </div>
    </div>
  )
}
