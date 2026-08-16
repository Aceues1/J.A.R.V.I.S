import type { TelemetryMetric } from '@renderer/types/hud'
import { MeterBar } from '@renderer/components/hud/MeterBar'

export function SystemStatusBlock({ metrics }: { metrics: TelemetryMetric[] }): React.JSX.Element {
  return (
    <div className="border-b border-cyan-dim/40 px-4 py-4">
      <p className="mb-3 font-mono text-[10px] tracking-[0.25em] text-ink-dim uppercase">
        System Status
      </p>
      <div className="space-y-3">
        {metrics.map((metric) => (
          <div key={metric.id}>
            <div className="mb-1 flex items-center justify-between font-mono text-[10px] tracking-[0.1em]">
              <span className="text-ink-dim">{metric.label}</span>
              <span className="text-cyan">
                {metric.value.toFixed(0)}
                {metric.unit}
              </span>
            </div>
            <MeterBar value={metric.value} />
          </div>
        ))}
      </div>
    </div>
  )
}
