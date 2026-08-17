import { useState } from 'react'
import type { StatusLevel } from '@renderer/types/hud'
import { useSimulatedTelemetry } from '@renderer/hooks/useSimulatedTelemetry'
import { useJarvisChat } from '@renderer/hooks/useJarvisChat'
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

export function AppShell(): React.JSX.Element {
  const [activeNavId, setActiveNavId] = useState(navItems[0].id)
  const [inputValue, setInputValue] = useState('')
  const metrics = useSimulatedTelemetry()
  const { messages, isLoading, error, sendMessage } = useJarvisChat()

  const status: StatusLevel = error ? 'alert' : isLoading ? 'processing' : 'online'

  const handleSubmit = (): void => {
    const text = inputValue
    setInputValue('')
    void sendMessage(text)
  }

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
        <CommandCenter
          status={status}
          metrics={metrics}
          log={diagnosticsLog}
          messages={messages}
          isLoading={isLoading}
          chatError={error}
        />
        <RightPanel events={eventItems} notes={noteItems} quotes={marketQuotes} />
      </div>
      <CommandBar
        status={status}
        value={inputValue}
        onChange={setInputValue}
        onSubmit={handleSubmit}
        isLoading={isLoading}
      />
    </div>
  )
}
