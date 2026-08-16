import type { EventItem } from '@renderer/types/hud'
import { HudPanel } from '@renderer/components/hud/HudPanel'

export function EventsCard({ events }: { events: EventItem[] }): React.JSX.Element {
  return (
    <HudPanel title="Upcoming Events" eyebrow="Calendar">
      <ul className="space-y-2">
        {events.map((event) => (
          <li key={event.id} className="flex items-center gap-3 font-mono text-[11px]">
            <span className="text-cyan">{event.time}</span>
            <span className="text-ink-dim">{event.title}</span>
          </li>
        ))}
      </ul>
    </HudPanel>
  )
}
