import { useState } from 'react'
import type { StatusLevel } from '@renderer/types/hud'
import { useSimulatedTelemetry } from '@renderer/hooks/useSimulatedTelemetry'
import {
  conversations,
  diagnosticsLog,
  eventItems,
  marketQuotes,
  navItems,
  noteItems
} from '@renderer/data/mock'
import { TitleBar } from './TitleBar'
import { Sidebar } from './Sidebar'
import { CommandCenter } from './CommandCenter'
import { RightPanel } from './RightPanel'
import { CommandBar } from './CommandBar'

const status: StatusLevel = 'standby'

export function AppShell(): React.JSX.Element {
  const [activeNavId, setActiveNavId] = useState(navItems[0].id)
  const metrics = useSimulatedTelemetry()

  return (
    <div className="circuit-grid radial-vignette flex h-screen flex-col bg-void">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar
          status={status}
          metrics={metrics}
          navItems={navItems}
          activeNavId={activeNavId}
          onSelectNav={setActiveNavId}
          conversations={conversations}
        />
        <CommandCenter status={status} metrics={metrics} log={diagnosticsLog} />
        <RightPanel events={eventItems} notes={noteItems} quotes={marketQuotes} />
      </div>
      <CommandBar status={status} />
    </div>
  )
}
