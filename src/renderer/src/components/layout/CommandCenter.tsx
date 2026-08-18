import type { ChatMessage, LogEntry, StatusLevel, TelemetryMetric } from '@renderer/types/hud'
import { AICore } from '@renderer/components/core/AICore'
import { ScanLine } from '@renderer/components/hud/ScanLine'
import { TelemetryGrid } from '@renderer/components/telemetry/TelemetryGrid'
import { DiagnosticsLog } from '@renderer/components/telemetry/DiagnosticsLog'
import { ConversationPanel } from '@renderer/components/chat/ConversationPanel'
import { VideoPlayerPanel } from '@renderer/components/media/VideoPlayerPanel'
import type { PlayerStatus } from '@renderer/hooks/useYouTubePlayer'
import { cn } from '@renderer/lib/cn'

interface CommandCenterProps {
  status: StatusLevel
  metrics: TelemetryMetric[]
  log: LogEntry[]
  messages: ChatMessage[]
  isLoading: boolean
  chatError: string | null
  onRetry: () => void
  playerStatus: PlayerStatus
  playerTitle: string | null
  playerEmbedUrl: string | null
  playerIframeRef: React.RefObject<HTMLIFrameElement | null>
  onPlayerIframeLoad: () => void
  onPlayerClose: () => void
}

const statusReadout: Record<StatusLevel, string> = {
  online: 'All systems nominal.',
  standby: 'Awaiting backend attachment.',
  listening: 'Listening for input.',
  processing: 'Processing request.',
  speaking: 'Speaking.',
  alert: 'Attention required.'
}

export function CommandCenter({
  status,
  metrics,
  log,
  messages,
  isLoading,
  chatError,
  onRetry,
  playerStatus,
  playerTitle,
  playerEmbedUrl,
  playerIframeRef,
  onPlayerIframeLoad,
  onPlayerClose
}: CommandCenterProps): React.JSX.Element {
  // Once an exchange starts, the core yields center stage to the transcript.
  const hasConversation = messages.length > 0 || isLoading || chatError !== null

  return (
    <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
      <ScanLine />

      <div
        className={cn(
          'relative flex flex-col items-center justify-center px-6',
          hasConversation ? 'shrink-0 pt-3' : 'flex-1'
        )}
      >
        <p
          className={cn(
            'font-mono text-[11px] tracking-[0.35em] text-ink-dim uppercase transition-opacity duration-500',
            hasConversation && 'hidden'
          )}
        >
          {statusReadout[status]}
        </p>
        <div
          className={cn(
            'transition-all duration-700 ease-out',
            hasConversation
              ? 'h-[110px] w-[110px] md:h-[150px] md:w-[150px]'
              : 'h-[220px] w-[220px] md:h-[320px] md:w-[320px]'
          )}
        >
          <AICore status={status} />
        </div>
        <p
          className={cn(
            'font-display tracking-[0.3em] text-ink text-glow transition-all duration-700',
            hasConversation ? 'text-sm' : 'mt-2 text-2xl'
          )}
        >
          JARVIS
        </p>
      </div>

      <VideoPlayerPanel
        status={playerStatus}
        title={playerTitle}
        embedUrl={playerEmbedUrl}
        iframeRef={playerIframeRef}
        onIframeLoad={onPlayerIframeLoad}
        onClose={onPlayerClose}
      />

      <div
        className={cn(
          'relative flex flex-col px-6 pt-3 pb-4',
          hasConversation ? 'min-h-0 flex-1' : 'shrink-0'
        )}
      >
        <ConversationPanel
          messages={messages}
          isLoading={isLoading}
          error={chatError}
          onRetry={onRetry}
          className={hasConversation ? 'flex-1' : ''}
        />
      </div>

      <div className="relative hidden shrink-0 grid-cols-1 gap-4 px-6 pb-6 md:grid lg:grid-cols-[1.4fr_1fr]">
        <TelemetryGrid metrics={metrics} />
        <DiagnosticsLog entries={log} />
      </div>
    </div>
  )
}
