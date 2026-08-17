import { useCallback, useEffect, useState } from 'react'
import type { StatusLevel } from '@renderer/types/hud'
import { useSimulatedTelemetry } from '@renderer/hooks/useSimulatedTelemetry'
import { useJarvisChat, type ChatEvent } from '@renderer/hooks/useJarvisChat'
import { useVoiceInput, type VoiceEvent } from '@renderer/hooks/useVoiceInput'
import { useSpeechPlayback, type SpeechEvent } from '@renderer/hooks/useSpeechPlayback'
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
      pushLog(voiceEventLevel[event.kind], event.detail)
    },
    [pushLog]
  )

  const voice = useVoiceInput(handleTranscript, handleVoiceEvent)

  const handleSpeechEvent = useCallback(
    (event: SpeechEvent) => {
      pushLog(event.kind === 'failed' ? 'warn' : 'info', event.detail)
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
      speak(last.id, last.content)
    }
  }, [messages, speak])

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

  const status: StatusLevel = error
    ? 'alert'
    : voice.state === 'recording'
      ? 'listening'
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
        onToggleVoice={voice.toggle}
        speechAvailable={speech.available === true}
        speechEnabled={speech.enabled}
        speaking={speech.speaking}
        onSpeakerClick={speech.speaking ? speech.stop : speech.toggleEnabled}
      />
    </div>
  )
}
