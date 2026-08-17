import { useCallback, useEffect, useRef, useState } from 'react'

export type VoiceState = 'idle' | 'recording' | 'transcribing'

export interface VoiceEvent {
  kind: 'listening' | 'transcribing' | 'transcript' | 'failed'
  detail: string
}

// Safety valve so a forgotten mic doesn't record indefinitely.
const MAX_RECORDING_MS = 60_000

const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']

function describeMicError(err: unknown): string {
  if (err instanceof DOMException) {
    switch (err.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return 'Microphone access denied. Allow microphone access for JARVIS in your system settings.'
      case 'NotFoundError':
      case 'OverconstrainedError':
        return 'No microphone detected. Connect one and try again.'
      case 'NotReadableError':
        return 'Microphone is busy or unavailable. Close other apps using it and try again.'
    }
  }
  return 'Could not access the microphone.'
}

interface UseVoiceInputResult {
  state: VoiceState
  error: string | null
  toggle: () => void
}

export function useVoiceInput(
  onTranscript: (text: string) => void,
  onEvent?: (event: VoiceEvent) => void
): UseVoiceInputResult {
  const [state, setState] = useState<VoiceState>('idle')
  const [error, setError] = useState<string | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onTranscriptRef = useRef(onTranscript)
  const onEventRef = useRef(onEvent)
  useEffect(() => {
    onTranscriptRef.current = onTranscript
    onEventRef.current = onEvent
  }, [onTranscript, onEvent])

  const releaseStream = useCallback(() => {
    if (stopTimerRef.current) {
      clearTimeout(stopTimerRef.current)
      stopTimerRef.current = null
    }
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    recorderRef.current = null
  }, [])

  useEffect(() => releaseStream, [releaseStream])

  const fail = useCallback(
    (message: string) => {
      setError(message)
      setState('idle')
      onEventRef.current?.({ kind: 'failed', detail: message })
    },
    [setError]
  )

  const finishRecording = useCallback(
    async (chunks: Blob[], mimeType: string) => {
      releaseStream()
      const blob = new Blob(chunks, { type: mimeType })
      if (blob.size === 0) {
        fail('No audio captured. Try again.')
        return
      }

      setState('transcribing')
      onEventRef.current?.({ kind: 'transcribing', detail: 'Transcribing voice input…' })
      try {
        const buffer = await blob.arrayBuffer()
        const result = await window.jarvis.voice.transcribe(buffer, mimeType)
        if (result.ok) {
          setState('idle')
          // Quote what was heard so the diagnostics log confirms the actual text.
          const preview = result.text.length > 48 ? `${result.text.slice(0, 48)}…` : result.text
          onEventRef.current?.({ kind: 'transcript', detail: `Transcribed: "${preview}"` })
          onTranscriptRef.current(result.text)
        } else {
          fail(result.error)
        }
      } catch {
        fail('Unexpected error transcribing audio.')
      }
    },
    [fail, releaseStream]
  )

  const start = useCallback(async () => {
    setError(null)

    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      fail('Voice capture is not supported in this environment.')
      return
    }

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err) {
      fail(describeMicError(err))
      return
    }

    const mimeType = MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) ?? ''
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    const chunks: Blob[] = []
    // MediaRecorder fires stop after error too — make sure only one path settles.
    let errored = false

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    }
    recorder.onerror = () => {
      errored = true
      releaseStream()
      fail('Recording failed. Try again.')
    }
    recorder.onstop = () => {
      if (errored) return
      void finishRecording(chunks, recorder.mimeType || 'audio/webm')
    }

    streamRef.current = stream
    recorderRef.current = recorder
    recorder.start()
    setState('recording')
    onEventRef.current?.({ kind: 'listening', detail: 'Microphone open — listening' })

    stopTimerRef.current = setTimeout(() => {
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
    }, MAX_RECORDING_MS)
  }, [fail, finishRecording, releaseStream])

  const toggle = useCallback(() => {
    if (state === 'transcribing') return
    if (state === 'recording') {
      recorderRef.current?.stop()
      return
    }
    void start()
  }, [start, state])

  return { state, error, toggle }
}
