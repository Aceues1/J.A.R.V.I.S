import type { TelemetryMetric } from '@renderer/types/hud'
import { HudPanel } from '@renderer/components/hud/HudPanel'
import { Sparkline } from '@renderer/components/hud/Sparkline'

export function TelemetryGrid({ metrics }: { metrics: TelemetryMetric[] }): React.JSX.Element {
  return (
    <HudPanel title="System Telemetry" eyebrow="Diagnostics">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {metrics.map((metric) => (
          <div key={metric.id} className="border border-cyan-dim/30 px-3 py-2.5">
            <p className="font-mono text-[9px] tracking-[0.15em] whitespace-nowrap text-ink-dim">
              {metric.label}
            </p>
            <p className="mt-1 font-display text-lg text-cyan text-glow">
              {metric.value.toFixed(0)}
              <span className="ml-1 text-xs text-ink-dim">{metric.unit}</span>
            </p>
            <Sparkline values={metric.history} width={100} height={26} />
          </div>
        ))}
      </div>
    </HudPanel>
  )
}
