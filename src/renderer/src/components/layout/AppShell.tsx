import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { StatusLevel } from '@renderer/types/hud'
import { useSimulatedTelemetry } from '@renderer/hooks/useSimulatedTelemetry'
import { useJarvisChat, type ChatEvent } from '@renderer/hooks/useJarvisChat'
import { useVoiceInput, type VoiceEvent } from '@renderer/hooks/useVoiceInput'
import { useSpeechPlayback, type SpeechEvent } from '@renderer/hooks/useSpeechPlayback'
import { HANDS_FREE_OFF, handsFreeReducer } from '@renderer/lib/handsFree'
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

const voiceEventLevel: Record<VoiceEvent['kind'], 'info' | 'ok' | 'warn'> = {
  listening: 'info',
  transcribing: 'info',
  transcript: 'ok',
  'no-speech': 'info',
  failed: 'warn'
}

const STARTUP_GREETING = 'Good evening, sir. All systems are online. How may I assist you?'

export function AppShell(): React.JSX.Element {
  const [activeNavId, setActiveNavId] = useState(navItems[0].id)
  const [inputValue, setInputValue] = useState('')
  const metrics = useSimulatedTelemetry()
  const backend = useBackendStatus()
  const { entries: logEntries, push: pushLog } = useDiagnosticsFeed()

  const [handsFree, dispatchHandsFree] = useReducer(handsFreeReducer, HANDS_FREE_OFF)

  // Every dispatch below is safe while hands-free is off — the reducer
  // ignores events that don't apply to the current phase.
  const handleChatEvent = useCallback(
    (event: ChatEvent) => {
      pushLog(chatEventLevel[event.kind], event.detail)
      if (event.kind === 'failed') {
        // A chat failure is surfaced with a RETRY control; stop the loop.
        dispatchHandsFree({ type: 'pipeline-error', recoverable: false })
      }
    },
    [pushLog]
  )

  const { messages, isLoading, error, sendMessage, addAssistantMessage, retry } =
    useJarvisChat(handleChatEvent)

  // Startup greeting lifecycle: inject once when the backend is ready, then
  // hand off to hands-free listening after the spoken greeting finishes.
  const greetingRef = useRef<'idle' | 'waiting-speech' | 'done'>('idle')

  // A transcript that can't be sent right now (request already in flight) is
  // parked in the input, visible, instead of being dropped.
  const handleTranscript = useCallback(
    (text: string) => {
      if (!sendMessage(text)) {
        setInputValue(text)
      }
    },
    [sendMessage]
  )

  const handleVoiceEvent = useCallback(
    (event: VoiceEvent) => {
      // Silent hands-free windows are discarded locally and retried; logging
      // each one would flood the diagnostics feed.
      if (event.kind !== 'no-speech') {
        pushLog(voiceEventLevel[event.kind], event.detail)
      }
      if (event.kind === 'transcribing') {
        dispatchHandsFree({ type: 'capture' })
      } else if (event.kind === 'no-speech') {
        dispatchHandsFree({ type: 'no-speech' })
      } else if (event.kind === 'failed') {
        dispatchHandsFree({ type: 'pipeline-error', recoverable: true })
      }
    },
    [pushLog]
  )

  const voice = useVoiceInput(handleTranscript, handleVoiceEvent)
  const { startAuto, cancelCapture, toggle: toggleMic } = voice

  const handleSpeechEvent = useCallback(
    (event: SpeechEvent) => {
      if (event.kind === 'failed') {
        pushLog('warn', event.detail)
      } else if (event.kind === 'speaking') {
        pushLog('info', event.detail)
      }
      if (event.kind === 'ended' || event.kind === 'failed') {
        dispatchHandsFree({ type: 'speech-ended' })
        // The spoken startup greeting has finished — start listening.
        if (greetingRef.current === 'waiting-speech') {
          greetingRef.current = 'done'
          dispatchHandsFree({ type: 'enable' })
          pushLog('ok', 'Hands-free conversation on')
        }
      }
    },
    [pushLog]
  )

  const speech = useSpeechPlayback(handleSpeechEvent)
  const { speak } = speech

  // Speak each newly arrived assistant reply; the hook dedupes by message id,
  // and a TTS failure leaves the rendered text untouched.
  useEffect(() => {
    const last = messages[messages.length - 1]
    if (last && last.role === 'assistant') {
      dispatchHandsFree({
        type: 'pipeline-ok',
        willSpeak: speech.enabled && speech.available === true
      })
      speak(last.id, last.content)
    }
  }, [messages, speak, speech.enabled, speech.available])

  // The hands-free loop: whenever the machine wants to listen and the mic is
  // free, open the next auto-capture window (silence-terminated, 60s cap).
  useEffect(() => {
    if (handsFree.phase === 'listening' && voice.state === 'idle') {
      startAuto()
    }
  }, [handsFree.phase, voice.state, startAuto])

  const toggleHandsFree = useCallback(() => {
    if (handsFree.phase === 'off') {
      dispatchHandsFree({ type: 'enable' })
      pushLog('ok', 'Hands-free conversation on')
    } else {
      dispatchHandsFree({ type: 'disable' })
      cancelCapture()
      pushLog('info', 'Hands-free conversation off')
    }
  }, [handsFree.phase, cancelCapture, pushLog])

  // Manual mic click takes back manual control: hands-free turns off, and if
  // an auto-capture was mid-recording the toggle stops it and sends the
  // speech through the normal manual flow.
  const handleMicToggle = useCallback(() => {
    if (handsFree.phase !== 'off') {
      dispatchHandsFree({ type: 'disable' })
      pushLog('info', 'Manual microphone control — hands-free off')
    }
    toggleMic()
  }, [handsFree.phase, toggleMic, pushLog])

  const { speaking: isSpeaking, stop: stopSpeaking, toggleEnabled: toggleSpeech } = speech
  const handleSpeakerClick = useCallback(() => {
    if (isSpeaking) {
      stopSpeaking()
      // A manual stop counts as the speech ending for the hands-free loop.
      dispatchHandsFree({ type: 'speech-ended' })
    } else {
      toggleSpeech()
    }
  }, [isSpeaking, stopSpeaking, toggleSpeech])

  useEffect(() => {
    if (speech.available === true) {
      pushLog('ok', `Voice output ready — ${speech.provider}`)
    } else if (speech.available === false) {
      pushLog('info', 'Voice output not configured — replies will be text-only')
    }
  }, [speech.available, speech.provider, pushLog])

  useEffect(() => {
    if (backend.configured === true) {
      pushLog('ok', `AI link ready — ${backend.model}`)
    } else if (backend.configured === false) {
      pushLog('warn', 'GROQ_API_KEY not set — AI link offline')
    }
  }, [backend.configured, backend.model, pushLog])

  // Deliver the startup greeting once the backend is ready and the TTS status
  // is known. When it will be spoken, hands-free starts as the speech ends
  // (see handleSpeechEvent); otherwise it starts right away.
  useEffect(() => {
    if (greetingRef.current !== 'idle') return
    if (backend.configured !== true || speech.available === null) return

    const willSpeak = speech.enabled && speech.available === true
    greetingRef.current = willSpeak ? 'waiting-speech' : 'done'
    addAssistantMessage(STARTUP_GREETING)
    if (!willSpeak) {
      dispatchHandsFree({ type: 'enable' })
      pushLog('ok', 'Hands-free conversation on')
    }
  }, [backend.configured, speech.available, speech.enabled, addAssistantMessage, pushLog])

  const status: StatusLevel = error
    ? 'alert'
    : voice.state === 'recording'
      ? 'listening'
      : speech.speaking
        ? 'speaking'
        : isLoading || voice.state === 'transcribing'
          ? 'processing'
          : backend.configured
            ? 'online'
            : 'standby'

  const handleSubmit = useCallback(() => {
    if (sendMessage(inputValue)) {
      setInputValue('')
    }
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
        voiceState={voice.state}
        voiceError={voice.error}
        onToggleVoice={handleMicToggle}
        speechAvailable={speech.available === true}
        speechEnabled={speech.enabled}
        speaking={speech.speaking}
        onSpeakerClick={handleSpeakerClick}
        handsFreePhase={handsFree.phase}
        onToggleHandsFree={toggleHandsFree}
      />
    </div>
  )
}
