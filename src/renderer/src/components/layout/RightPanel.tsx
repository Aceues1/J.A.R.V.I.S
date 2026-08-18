import { memo } from 'react'
import type { EventItem, MarketQuote, NoteItem } from '@renderer/types/hud'
import { SystemInfoCard } from '@renderer/components/rightpanel/SystemInfoCard'
import { WeatherCard } from '@renderer/components/rightpanel/WeatherCard'
import { EventsCard } from '@renderer/components/rightpanel/EventsCard'
import { NotesActivityCard } from '@renderer/components/rightpanel/NotesActivityCard'
import { MarketModule } from '@renderer/components/market/MarketModule'

interface RightPanelProps {
  events: EventItem[]
  notes: NoteItem[]
  quotes: MarketQuote[]
}

export const RightPanel = memo(function RightPanel({
  events,
  notes,
  quotes
}: RightPanelProps): React.JSX.Element {
  return (
    <aside className="hidden w-80 shrink-0 space-y-4 overflow-y-auto border-l border-cyan-dim/40 bg-void-deep/60 p-4 xl:block">
      <SystemInfoCard />
      <WeatherCard />
      <MarketModule quotes={quotes} />
      <EventsCard events={events} />
      <NotesActivityCard notes={notes} />
    </aside>
  )
})
