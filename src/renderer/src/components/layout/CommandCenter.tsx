import type { ChatMessage, LogEntry, StatusLevel, TelemetryMetric } from '@renderer/types/hud'
import { AICore } from '@renderer/components/core/AICore'
import { ScanLine } from '@renderer/components/hud/ScanLine'
import { TelemetryGrid } from '@renderer/components/telemetry/TelemetryGrid'
import { DiagnosticsLog } from '@renderer/components/telemetry/DiagnosticsLog'
import { ConversationPanel } from '@renderer/components/chat/ConversationPanel'

interface CommandCenterProps {
  status: StatusLevel
  metrics: TelemetryMetric[]
  log: LogEntry[]
  messages: ChatMessage[]
  isLoading: boolean
  chatError: string | null
}

const statusReadout: Record<StatusLevel, string> = {
  online: 'All systems nominal.',
  standby: 'Awaiting backend attachment.',
  listening: 'Listening for input.',
  processing: 'Processing request.',
  alert: 'Attention required.'
}

export function CommandCenter({
  status,
  metrics,
  log,
  messages,
  isLoading,
  chatError
}: CommandCenterProps): React.JSX.Element {
  return (
    <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
      <ScanLine />

      <div className="relative flex flex-1 flex-col items-center justify-center px-6">
        <p className="mb-2 font-mono text-[11px] tracking-[0.35em] text-ink-dim uppercase">
          {statusReadout[status]}
        </p>
        <div className="h-[320px] w-[320px]">
          <AICore status={status} />
        </div>
        <p className="mt-2 font-display text-2xl tracking-[0.3em] text-ink text-glow">JARVIS</p>
      </div>

      <div className="relative shrink-0 px-6 pb-4">
        <ConversationPanel messages={messages} isLoading={isLoading} error={chatError} />
      </div>

      <div className="relative grid shrink-0 grid-cols-1 gap-4 px-6 pb-6 lg:grid-cols-[1.4fr_1fr]">
        <TelemetryGrid metrics={metrics} />
        <DiagnosticsLog entries={log} />
      </div>
    </div>
  )
}
