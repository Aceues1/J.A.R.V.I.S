import { useEffect, useState } from 'react'

export interface BackendStatus {
  /** null while the initial IPC query is in flight */
  configured: boolean | null
  model: string
}

export function useBackendStatus(): BackendStatus {
  const [status, setStatus] = useState<BackendStatus>({ configured: null, model: '' })

  useEffect(() => {
    let cancelled = false
    window.jarvis.chat
      .getStatus()
      .then((result) => {
        if (!cancelled) setStatus(result)
      })
      .catch(() => {
        if (!cancelled) setStatus({ configured: false, model: '' })
      })
    return () => {
      cancelled = true
    }
  }, [])

  return status
}
