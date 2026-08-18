import { useEffect, useState } from 'react'
import type { SystemStatus } from '@renderer/types/hud'

// The main process caches samples for a few seconds; a 10s poll keeps the
// HUD current without meaningful overhead.
const REFRESH_INTERVAL_MS = 10_000

export function useSystemStatus(): SystemStatus | null {
  const [status, setStatus] = useState<SystemStatus | null>(null)

  useEffect(() => {
    let cancelled = false

    const refresh = async (): Promise<void> => {
      try {
        const result = await window.jarvis.system.getStatus()
        if (!cancelled && result.ok) setStatus(result.status)
      } catch {
        // keep last shown values
      }
    }

    void refresh()
    const timer = setInterval(() => void refresh(), REFRESH_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  return status
}
