import type { LocationWeather, WeatherIcon } from '@renderer/types/hud'
import { HudPanel } from '@renderer/components/hud/HudPanel'
import { useWeather } from '@renderer/hooks/useWeather'
import { cn } from '@renderer/lib/cn'

function WeatherGlyph({ icon }: { icon: WeatherIcon }): React.JSX.Element {
  // One compact 24px glyph per condition family, drawn in the HUD line style.
  switch (icon) {
    case 'sun':
      return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-warn">
          <circle cx="12" cy="12" r="4.5" stroke="currentColor" />
          <g stroke="currentColor" strokeLinecap="round">
            <line x1="12" y1="2.5" x2="12" y2="5" />
            <line x1="12" y1="19" x2="12" y2="21.5" />
            <line x1="2.5" y1="12" x2="5" y2="12" />
            <line x1="19" y1="12" x2="21.5" y2="12" />
          </g>
        </svg>
      )
    case 'part-cloud':
      return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-cyan">
          <circle cx="9" cy="9" r="3.5" stroke="currentColor" opacity="0.7" />
          <path
            d="M7 17.5h9a3 3 0 0 0 .4-6 4.5 4.5 0 0 0-8.6 1.2A2.6 2.6 0 0 0 7 17.5Z"
            stroke="currentColor"
          />
        </svg>
      )
    case 'cloud':
    case 'fog':
      return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-ink-dim">
          <path
            d="M6.5 16h10.5a3.2 3.2 0 0 0 .4-6.4 5 5 0 0 0-9.6 1.3A2.9 2.9 0 0 0 6.5 16Z"
            stroke="currentColor"
          />
          {icon === 'fog' && (
            <g stroke="currentColor" strokeLinecap="round" opacity="0.7">
              <line x1="6" y1="19" x2="18" y2="19" />
              <line x1="8" y1="21.5" x2="16" y2="21.5" />
            </g>
          )}
        </svg>
      )
    case 'drizzle':
    case 'rain':
      return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-cyan">
          <path
            d="M6.5 14h10.5a3.2 3.2 0 0 0 .4-6.4 5 5 0 0 0-9.6 1.3A2.9 2.9 0 0 0 6.5 14Z"
            stroke="currentColor"
          />
          <g stroke="currentColor" strokeLinecap="round" opacity={icon === 'drizzle' ? 0.6 : 1}>
            <line x1="9" y1="17" x2="8" y2="20.5" />
            <line x1="13" y1="17" x2="12" y2="20.5" />
            <line x1="17" y1="17" x2="16" y2="20.5" />
          </g>
        </svg>
      )
    case 'snow':
      return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-cyan-bright">
          <path
            d="M6.5 14h10.5a3.2 3.2 0 0 0 .4-6.4 5 5 0 0 0-9.6 1.3A2.9 2.9 0 0 0 6.5 14Z"
            stroke="currentColor"
          />
          <g stroke="currentColor" strokeLinecap="round">
            <path d="M9 18l0 3M7.7 19.5h2.6" />
            <path d="M15 18l0 3M13.7 19.5h2.6" />
          </g>
        </svg>
      )
    case 'thunder':
      return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-warn">
          <path
            d="M6.5 13h10.5a3.2 3.2 0 0 0 .4-6.4 5 5 0 0 0-9.6 1.3A2.9 2.9 0 0 0 6.5 13Z"
            stroke="currentColor"
          />
          <path d="M12.5 14.5 10 18h3l-2 4" stroke="currentColor" strokeLinejoin="round" />
        </svg>
      )
  }
}

function LocationRow({ weather }: { weather: LocationWeather }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="truncate font-mono text-[10px] tracking-[0.2em] text-ink-dim uppercase">
          {weather.label}
        </p>
        <p className="font-display text-lg leading-tight text-ink">
          {weather.temperature}°C
          <span className="ml-2 font-sans text-xs font-medium text-ink-dim">
            {weather.condition}
          </span>
        </p>
        <p className="font-mono text-[9px] tracking-[0.12em] text-ink-dim/80">
          FEELS {weather.feelsLike}° · WIND {weather.windSpeed} M/S · H {weather.high}° / L{' '}
          {weather.low}°
        </p>
      </div>
      <WeatherGlyph icon={weather.icon} />
    </div>
  )
}

export function WeatherCard(): React.JSX.Element {
  const { report, stale, loading } = useWeather()

  return (
    <HudPanel title="Weather" eyebrow="Regional Monitor">
      {report ? (
        <div className="space-y-3">
          {report.locations.map((location) => (
            <LocationRow key={location.id} weather={location} />
          ))}
          <p
            className={cn(
              'border-t border-cyan-dim/30 pt-1.5 font-mono text-[9px] tracking-[0.15em]',
              stale ? 'text-warn' : 'text-ink-dim/70'
            )}
          >
            {stale ? 'LINK DEGRADED — SHOWING LAST DATA · ' : 'UPDATED '}
            {new Date(report.updatedAt).toLocaleTimeString([], { hour12: false })}
          </p>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <div>
            <p className="font-display text-2xl text-ink-dim">--°</p>
            <p className="font-mono text-[10px] tracking-[0.15em] text-ink-dim">
              {loading ? 'ACQUIRING WEATHER DATA' : 'WEATHER LINK OFFLINE'}
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
      )}
    </HudPanel>
  )
}
