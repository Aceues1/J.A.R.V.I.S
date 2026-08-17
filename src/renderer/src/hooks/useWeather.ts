import { useEffect, useState } from 'react'
import type { WeatherReport } from '@renderer/types/hud'

// The main process caches for 5 minutes; polling every 10 keeps the panel
// current without hammering the API.
const REFRESH_INTERVAL_MS = 10 * 60_000

interface UseWeatherResult {
  report: WeatherReport | null
  /** True when the latest refresh failed — shown data is the last success. */
  stale: boolean
  loading: boolean
}

export function useWeather(): UseWeatherResult {
  const [report, setReport] = useState<WeatherReport | null>(null)
  const [stale, setStale] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    const refresh = async (): Promise<void> => {
      try {
        const result = await window.jarvis.weather.get()
        if (cancelled) return
        if (result.ok) {
          setReport(result.report)
          setStale(false)
        } else {
          // Keep whatever we last showed; just flag it.
          setStale(true)
        }
      } catch {
        if (!cancelled) setStale(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void refresh()
    const timer = setInterval(() => void refresh(), REFRESH_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  return { report, stale, loading }
}
