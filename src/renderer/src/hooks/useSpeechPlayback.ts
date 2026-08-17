import { useCallback, useEffect, useRef, useState } from 'react'

export interface SpeechEvent {
  kind: 'speaking' | 'ended' | 'failed'
  detail: string
}

interface UseSpeechPlaybackResult {
  /** null while the initial status query is in flight */
  available: boolean | null
  provider: string
  enabled: boolean
  speaking: boolean
  /** Speak a message once; repeated calls with the same id are ignored. */
  speak: (id: string, text: string) => void
  stop: () => void
  toggleEnabled: () => void
}

export function useSpeechPlayback(onEvent?: (event: SpeechEvent) => void): UseSpeechPlaybackResult {
  const [available, setAvailable] = useState<boolean | null>(null)
  const [provider, setProvider] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [speaking, setSpeaking] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const urlRef = useRef<string | null>(null)
  // Message ids that were already sent for synthesis — the dedupe guard that
  // keeps a response from being spoken twice (re-renders, retries, etc.).
  const spokenIdsRef = useRef(new Set<string>())
  const enabledRef = useRef(enabled)
  const availableRef = useRef<boolean | null>(null)
  const onEventRef = useRef(onEvent)
  useEffect(() => {
    onEventRef.current = onEvent
  }, [onEvent])

  useEffect(() => {
    let cancelled = false
    window.jarvis.voice
      .getTtsStatus()
      .then((status) => {
        if (cancelled) return
        setAvailable(status.configured)
        setProvider(status.provider)
        availableRef.current = status.configured
      })
      .catch(() => {
        if (cancelled) return
        setAvailable(false)
        availableRef.current = false
      })
    return () => {
      cancelled = true
    }
  }, [])

  const stop = useCallback(() => {
    const audio = audioRef.current
    if (audio) {
      audio.pause()
      audio.src = ''
      audioRef.current = null
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current)
      urlRef.current = null
    }
    setSpeaking(false)
  }, [])

  useEffect(() => stop, [stop])

  const speak = useCallback(
    (id: string, text: string) => {
      if (!enabledRef.current || availableRef.current !== true) return
      if (spokenIdsRef.current.has(id)) return
      spokenIdsRef.current.add(id)

      void (async () => {
        try {
          const result = await window.jarvis.voice.speak(text)
          if (!result.ok) {
            onEventRef.current?.({ kind: 'failed', detail: result.error })
            return
          }
          // The user may have muted or started another playback meanwhile.
          if (!enabledRef.current) return
          stop()

          const blob = new Blob([result.audio.slice()], { type: result.mimeType })
          const url = URL.createObjectURL(blob)
          const audio = new Audio(url)
          urlRef.current = url
          audioRef.current = audio
          audio.onended = () => {
            if (audioRef.current === audio) {
              stop()
              onEventRef.current?.({ kind: 'ended', detail: 'Finished speaking' })
            }
          }
          audio.onerror = () => {
            if (audioRef.current === audio) {
              stop()
              onEventRef.current?.({ kind: 'failed', detail: 'Audio playback failed.' })
            }
          }
          await audio.play()
          setSpeaking(true)
          onEventRef.current?.({ kind: 'speaking', detail: 'Speaking response' })
        } catch {
          stop()
          onEventRef.current?.({ kind: 'failed', detail: 'Voice output failed.' })
        }
      })()
    },
    [stop]
  )

  const toggleEnabled = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev
      enabledRef.current = next
      if (!next) stop()
      return next
    })
  }, [stop])

  return { available, provider, enabled, speaking, speak, stop, toggleEnabled }
}
