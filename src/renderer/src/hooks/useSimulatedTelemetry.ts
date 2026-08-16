import { useEffect, useState } from 'react'
import type { TelemetryMetric } from '@renderer/types/hud'
import { usePrefersReducedMotion } from './usePrefersReducedMotion'

const HISTORY_LENGTH = 24

function seedHistory(base: number, spread: number): number[] {
  return Array.from({ length: HISTORY_LENGTH }, () => clamp(base + (Math.random() - 0.5) * spread))
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value))
}

function step(value: number, spread: number, min = 0, max = 100): number {
  return clamp(value + (Math.random() - 0.5) * spread, min, max)
}

const initialMetrics: TelemetryMetric[] = [
  { id: 'cpu', label: 'CPU LOAD', value: 34, unit: '%', history: seedHistory(34, 14) },
  { id: 'mem', label: 'MEMORY', value: 48, unit: '%', history: seedHistory(48, 8) },
  { id: 'net', label: 'NET I/O', value: 62, unit: 'Mb/s', history: seedHistory(62, 20) },
  { id: 'latency', label: 'LATENCY', value: 18, unit: 'ms', history: seedHistory(18, 6) }
]

export function useSimulatedTelemetry(): TelemetryMetric[] {
  const [metrics, setMetrics] = useState(initialMetrics)
  const reducedMotion = usePrefersReducedMotion()

  useEffect(() => {
    const intervalMs = reducedMotion ? 4000 : 1800
    const id = window.setInterval(() => {
      setMetrics((prev) =>
        prev.map((metric) => {
          const next = step(metric.value, metric.id === 'net' ? 16 : 10, 4, 96)
          return {
            ...metric,
            value: next,
            history: [...metric.history.slice(1), next]
          }
        })
      )
    }, intervalMs)
    return () => window.clearInterval(id)
  }, [reducedMotion])

  return metrics
}
