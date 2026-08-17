import { useCallback, useEffect, useState } from 'react'
import type { StatusLevel } from '@renderer/types/hud'
import { useSimulatedTelemetry } from '@renderer/hooks/useSimulatedTelemetry'
import { useJarvisChat, type ChatEvent } from '@renderer/hooks/useJarvisChat'
import { useBackendStatus } from '@renderer/hooks/useBackendStatus'
import { useDiagnosticsFeed } from '@renderer/hooks/useDiagnosticsFeed'
import { conversations, eventItems, marketQuotes, navItems, noteItems } from '@renderer/data/mock'
import { TitleBar } from './TitleBar'
import { Sidebar } from './Sidebar'
import { CommandCenter } from './CommandCenter'
import { RightPanel } from './RightPanel'
import { CommandBar } from './CommandBar'

const chatEventLevel: Record<ChatEvent['kind'], 'info' | 'ok' | 'warn'> = {
  sent: 'info',
  received: 'ok',
  failed: 'warn'
}

export function AppShell(): React.JSX.Element {
  const [activeNavId, setActiveNavId] = useState(navItems[0].id)
  const [inputValue, setInputValue] = useState('')
  const metrics = useSimulatedTelemetry()
  const backend = useBackendStatus()
  const { entries: logEntries, push: pushLog } = useDiagnosticsFeed()

  const handleChatEvent = useCallback(
    (event: ChatEvent) => {
      pushLog(chatEventLevel[event.kind], event.detail)
    },
    [pushLog]
  )

  const { messages, isLoading, error, sendMessage, retry } = useJarvisChat(handleChatEvent)

  useEffect(() => {
    if (backend.configured === true) {
      pushLog('ok', `AI link ready — ${backend.model}`)
    } else if (backend.configured === false) {
      pushLog('warn', 'GROQ_API_KEY not set — AI link offline')
    }
  }, [backend.configured, backend.model, pushLog])

  const status: StatusLevel = error
    ? 'alert'
    : isLoading
      ? 'processing'
      : backend.configured
        ? 'online'
        : 'standby'

  const handleSubmit = useCallback(() => {
    sendMessage(inputValue)
    setInputValue('')
  }, [inputValue, sendMessage])

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
          log={logEntries}
          messages={messages}
          isLoading={isLoading}
          chatError={error}
          onRetry={retry}
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
