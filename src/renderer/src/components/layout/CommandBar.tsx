import { memo, useEffect, useRef } from 'react'
import type { StatusLevel } from '@renderer/types/hud'
import type { VoiceState } from '@renderer/hooks/useVoiceInput'
import { cn } from '@renderer/lib/cn'

const MAX_INPUT_LENGTH = 4000

interface CommandBarProps {
  status: StatusLevel
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  isLoading: boolean
  voiceState: VoiceState
  voiceError: string | null
  onToggleVoice: () => void
}

const micLabelByState: Record<VoiceState, string> = {
  idle: 'Start voice input',
  recording: 'Stop recording and send',
  transcribing: 'Transcribing…'
}

export const CommandBar = memo(function CommandBar({
  status,
  value,
  onChange,
  onSubmit,
  isLoading,
  voiceState,
  voiceError,
  onToggleVoice
}: CommandBarProps): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const canSubmit = value.trim().length > 0 && !isLoading
  const isRecording = voiceState === 'recording'
  // Stopping an active recording is always allowed; only starting a new one
  // is blocked while a request is in flight or a transcription is running.
  const micBusy = voiceState === 'transcribing' || (isLoading && !isRecording)

  // The input is disabled while a request is in flight, which drops focus —
  // reclaim it when the response lands so the user can keep typing.
  useEffect(() => {
    if (!isLoading) inputRef.current?.focus()
  }, [isLoading])

  return (
    <div className="shrink-0 border-t border-cyan-dim/40 bg-void-deep/80 px-6 py-4">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (canSubmit) onSubmit()
        }}
        className="hud-panel flex items-center gap-3 px-3 py-2.5"
      >
        <span
          className={cn(
            'h-1.5 w-1.5 shrink-0 rounded-full bg-cyan',
            isLoading && 'animate-[var(--animate-blink)]'
          )}
        />

        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={isLoading}
          maxLength={MAX_INPUT_LENGTH}
          autoFocus
          placeholder={
            isLoading
              ? 'JARVIS is processing…'
              : isRecording
                ? 'Listening — click the mic again to send'
                : voiceState === 'transcribing'
                  ? 'Transcribing voice input…'
                  : 'Ask Jarvis...'
          }
          aria-label="Ask Jarvis"
          className="flex-1 bg-transparent font-sans text-base tracking-wide text-ink placeholder:text-ink-dim/70 focus:outline-none disabled:opacity-60"
        />

        <span className="hidden shrink-0 font-mono text-[10px] tracking-[0.15em] text-ink-dim sm:inline">
          {status.toUpperCase()}
        </span>

        <button
          type="button"
          aria-pressed={isRecording}
          aria-label={micLabelByState[voiceState]}
          title={micLabelByState[voiceState]}
          disabled={micBusy}
          onClick={onToggleVoice}
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center border transition-colors',
            isRecording
              ? 'border-alert bg-alert/15 text-alert animate-[var(--animate-blink)]'
              : voiceState === 'transcribing'
                ? 'border-warn/60 text-warn'
                : 'border-cyan-dim/60 text-ink-dim hover:border-cyan/60 hover:text-cyan',
            micBusy && 'cursor-not-allowed opacity-60'
          )}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="6" y="1.5" width="4" height="8" rx="2" stroke="currentColor" />
            <path d="M3.5 8.5a4.5 4.5 0 0 0 9 0" stroke="currentColor" />
            <line x1="8" y1="13" x2="8" y2="14.5" stroke="currentColor" />
          </svg>
        </button>

        <button
          type="submit"
          aria-label="Send"
          disabled={!canSubmit}
          className="flex h-9 w-9 shrink-0 items-center justify-center border border-cyan/60 text-cyan transition-colors hover:bg-cyan/15 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M1.5 8h13M9 3l5.5 5-5.5 5"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </form>
      <p
        className={cn(
          'mt-1.5 px-1 font-mono text-[9px] tracking-[0.15em]',
          voiceError ? 'text-warn' : 'text-ink-dim/70'
        )}
      >
        {voiceError
          ? voiceError.toUpperCase()
          : isRecording
            ? 'LISTENING — CLICK THE MIC AGAIN TO SEND'
            : 'CLICK THE MIC TO SPEAK · VOICE OUTPUT, TOOLS AND COMPUTER CONTROL ARRIVE IN A LATER PHASE'}
      </p>
    </div>
  )
})
