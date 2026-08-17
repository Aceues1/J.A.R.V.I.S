import { useCallback, useState } from 'react'
import type { LogEntry } from '@renderer/types/hud'

const MAX_ENTRIES = 50

function stamp(): string {
  return new Date().toLocaleTimeString([], { hour12: false })
}

interface UseDiagnosticsFeedResult {
  entries: LogEntry[]
  push: (level: LogEntry['level'], message: string) => void
}

export function useDiagnosticsFeed(): UseDiagnosticsFeedResult {
  const [entries, setEntries] = useState<LogEntry[]>(() => [
    { id: crypto.randomUUID(), time: stamp(), level: 'ok', message: 'Core link established' },
    {
      id: crypto.randomUUID(),
      time: stamp(),
      level: 'info',
      message: 'Interface shell initialized'
    }
  ])

  const push = useCallback((level: LogEntry['level'], message: string) => {
    setEntries((prev) => {
      const next = [...prev, { id: crypto.randomUUID(), time: stamp(), level, message }]
      return next.length > MAX_ENTRIES ? next.slice(-MAX_ENTRIES) : next
    })
  }, [])

  return { entries, push }
}
