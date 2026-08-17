import { useCallback, useEffect, useRef, useState } from 'react'

export type VoiceState = 'idle' | 'recording' | 'transcribing'

export interface VoiceEvent {
  kind: 'listening' | 'transcribing' | 'transcript' | 'no-speech' | 'failed'
  detail: string
}

// Safety valve so a forgotten mic doesn't record indefinitely.
const MAX_RECORDING_MS = 60_000

// Auto-capture (hands-free) tuning: once speech has been heard, this much
// trailing silence ends the capture; a window with no speech at all is
// discarded locally after the timeout — no transcription request is made.
export const SILENCE_STOP_MS = 1600
export const NO_SPEECH_TIMEOUT_MS = 8000
const SPEECH_RMS_THRESHOLD = 0.015
const LEVEL_POLL_MS = 100
// Opening a capture produces a brief level transient (device settle / AGC);
// ignore readings this long after start so it isn't mistaken for speech.
const LEVEL_WARMUP_MS = 700

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
  /** Manual mic button: start on idle, stop-and-send while recording. */
  toggle: () => void
  /** Hands-free: start a capture window with silence auto-stop. */
  startAuto: () => void
  /** Hands-free: abort any active capture, discarding its audio. */
  cancelCapture: () => void
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
  const levelTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const startingRef = useRef(false)
  // When set, the active capture's audio is thrown away on stop.
  const discardRef = useRef(false)
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
    if (levelTimerRef.current) {
      clearInterval(levelTimerRef.current)
      levelTimerRef.current = null
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => {})
      audioCtxRef.current = null
    }
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    recorderRef.current = null
  }, [])

  useEffect(() => releaseStream, [releaseStream])

  const fail = useCallback((message: string) => {
    setError(message)
    setState('idle')
    onEventRef.current?.({ kind: 'failed', detail: message })
  }, [])

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

  const start = useCallback(
    async (auto: boolean) => {
      if (startingRef.current) return
      startingRef.current = true
      setError(null)
      discardRef.current = false

      try {
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
          if (discardRef.current) {
            releaseStream()
            setState('idle')
            onEventRef.current?.({ kind: 'no-speech', detail: 'No speech detected in window' })
            return
          }
          void finishRecording(chunks, recorder.mimeType || 'audio/webm')
        }

        streamRef.current = stream
        recorderRef.current = recorder

        if (auto) {
          // Watch the mic level so the capture ends itself: trailing silence
          // after speech sends the audio; a fully silent window is discarded.
          const audioCtx = new AudioContext()
          const analyser = audioCtx.createAnalyser()
          analyser.fftSize = 2048
          audioCtx.createMediaStreamSource(stream).connect(analyser)
          audioCtxRef.current = audioCtx
          const samples = new Float32Array(analyser.fftSize)
          const startedAt = Date.now()
          let speechHeard = false
          let lastLoudAt = startedAt

          levelTimerRef.current = setInterval(() => {
            const active = recorderRef.current
            if (!active || active.state !== 'recording') return
            if (Date.now() - startedAt < LEVEL_WARMUP_MS) return
            analyser.getFloatTimeDomainData(samples)
            let sum = 0
            for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i]
            const rms = Math.sqrt(sum / samples.length)
            const now = Date.now()

            if (rms > SPEECH_RMS_THRESHOLD) {
              speechHeard = true
              lastLoudAt = now
            } else if (speechHeard && now - lastLoudAt > SILENCE_STOP_MS) {
              active.stop()
            } else if (!speechHeard && now - startedAt > NO_SPEECH_TIMEOUT_MS) {
              discardRef.current = true
              active.stop()
            }
          }, LEVEL_POLL_MS)
        }

        recorder.start()
        setState('recording')
        onEventRef.current?.({
          kind: 'listening',
          detail: auto ? 'Hands-free: listening' : 'Microphone open — listening'
        })

        stopTimerRef.current = setTimeout(() => {
          if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
        }, MAX_RECORDING_MS)
      } finally {
        startingRef.current = false
      }
    },
    [fail, finishRecording, releaseStream]
  )

  const toggle = useCallback(() => {
    if (state === 'transcribing') return
    if (state === 'recording') {
      recorderRef.current?.stop()
      return
    }
    void start(false)
  }, [start, state])

  const startAuto = useCallback(() => {
    if (state !== 'idle') return
    void start(true)
  }, [start, state])

  const cancelCapture = useCallback(() => {
    const recorder = recorderRef.current
    if (recorder && recorder.state === 'recording') {
      discardRef.current = true
      recorder.stop()
    }
  }, [])

  return { state, error, toggle, startAuto, cancelCapture }
}
