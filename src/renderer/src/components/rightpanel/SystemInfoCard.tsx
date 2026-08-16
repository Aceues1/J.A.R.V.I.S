import { useClock } from '@renderer/hooks/useClock'
import { HudPanel } from '@renderer/components/hud/HudPanel'

export function SystemInfoCard(): React.JSX.Element {
  const now = useClock()
  const { platform, versions } = window.jarvis.system

  return (
    <HudPanel title="System Information" eyebrow="Host">
      <dl className="space-y-1.5 font-mono text-[11px]">
        <Row label="LOCAL TIME" value={now.toLocaleTimeString([], { hour12: false })} />
        <Row label="DATE" value={now.toLocaleDateString(undefined, { dateStyle: 'medium' })} />
        <Row label="PLATFORM" value={platform} />
        <Row label="ELECTRON" value={versions.electron} />
        <Row label="CHROME" value={versions.chrome} />
        <Row label="NODE" value={versions.node} />
      </dl>
    </HudPanel>
  )
}

function Row({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-ink-dim">{label}</dt>
      <dd className="text-cyan">{value}</dd>
    </div>
  )
}
