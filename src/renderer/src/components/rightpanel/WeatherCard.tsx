import { HudPanel } from '@renderer/components/hud/HudPanel'

export function WeatherCard(): React.JSX.Element {
  return (
    <HudPanel title="Weather" eyebrow="Local Conditions">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-display text-2xl text-ink-dim">--°</p>
          <p className="font-mono text-[10px] tracking-[0.15em] text-ink-dim">
            AWAITING LOCATION SERVICE
          </p>
        </div>
        <svg width="36" height="36" viewBox="0 0 36 36" className="text-ink-dim/60">
          <circle cx="18" cy="18" r="8" stroke="currentColor" fill="none" />
          <g stroke="currentColor">
            <line x1="18" y1="2" x2="18" y2="6" />
            <line x1="18" y1="30" x2="18" y2="34" />
            <line x1="2" y1="18" x2="6" y2="18" />
            <line x1="30" y1="18" x2="34" y2="18" />
          </g>
        </svg>
      </div>
    </HudPanel>
  )
}
