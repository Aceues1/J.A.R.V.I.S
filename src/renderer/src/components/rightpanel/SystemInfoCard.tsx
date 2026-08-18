import { useClock } from '@renderer/hooks/useClock'
import { useSystemStatus } from '@renderer/hooks/useSystemStatus'
import { HudPanel } from '@renderer/components/hud/HudPanel'

export function SystemInfoCard(): React.JSX.Element {
  const now = useClock()
  const status = useSystemStatus()
  const { platform, versions } = window.jarvis.system

  return (
    <HudPanel title="System Information" eyebrow="Host">
      <dl className="space-y-1.5 font-mono text-[11px]">
        <Row label="LOCAL TIME" value={now.toLocaleTimeString([], { hour12: false })} />
        <Row label="DATE" value={now.toLocaleDateString(undefined, { dateStyle: 'medium' })} />
        {status && (
          <>
            <Row label="CPU" value={`${status.cpuUsagePercent}%`} />
            <Row
              label="MEMORY"
              value={`${status.ramUsedPercent}% · ${status.ramUsedGb}/${status.ramTotalGb} GB`}
            />
            {status.diskUsedPercent !== null && (
              <Row
                label="DISK"
                value={`${status.diskUsedPercent}% · ${status.diskFreeGb} GB FREE`}
              />
            )}
            <Row label="UPTIME" value={`${status.uptimeHours} H`} />
          </>
        )}
        <Row label="PLATFORM" value={platform} />
        <Row label="ELECTRON" value={versions.electron} />
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
