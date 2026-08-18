import { HudPanel } from '@renderer/components/hud/HudPanel'
import type { PlayerStatus } from '@renderer/hooks/useYouTubePlayer'
import { cn } from '@renderer/lib/cn'

interface VideoPlayerPanelProps {
  status: PlayerStatus
  title: string | null
  embedUrl: string | null
  iframeRef: React.RefObject<HTMLIFrameElement | null>
  onIframeLoad: () => void
  onClose: () => void
}

const statusLabel: Record<Exclude<PlayerStatus, 'hidden'>, string> = {
  loading: 'LOADING',
  playing: 'PLAYING',
  paused: 'PAUSED',
  error: 'ERROR'
}

export function VideoPlayerPanel({
  status,
  title,
  embedUrl,
  iframeRef,
  onIframeLoad,
  onClose
}: VideoPlayerPanelProps): React.JSX.Element | null {
  // Hidden until a video is requested — no empty player wasting HUD space.
  if (status === 'hidden' || !embedUrl) return null

  return (
    <div className="shrink-0 px-6 pt-3">
      <HudPanel
        eyebrow="Media"
        title={title || 'Video Feed'}
        className="relative"
        bodyClassName="p-0"
      >
        <div className="absolute top-3 right-3 flex items-center gap-2">
          <span
            className={cn(
              'font-mono text-[9px] tracking-[0.2em]',
              status === 'error' ? 'text-alert' : status === 'paused' ? 'text-warn' : 'text-cyan'
            )}
          >
            {statusLabel[status]}
          </span>
          <button
            type="button"
            aria-label="Close video player"
            onClick={onClose}
            className="flex h-5 w-5 items-center justify-center border border-cyan-dim/60 text-ink-dim transition-colors hover:border-alert/60 hover:text-alert"
          >
            <svg width="8" height="8" viewBox="0 0 8 8">
              <line x1="1" y1="1" x2="7" y2="7" stroke="currentColor" />
              <line x1="7" y1="1" x2="1" y2="7" stroke="currentColor" />
            </svg>
          </button>
        </div>
        {/* 16:9, scales with the panel — no horizontal overflow at any window size */}
        <div className="aspect-video w-full overflow-hidden border-t border-cyan-dim/30 bg-void-deep">
          <iframe
            ref={iframeRef}
            src={embedUrl}
            onLoad={onIframeLoad}
            title={title || 'JARVIS video feed'}
            className="h-full w-full"
            allow="autoplay; encrypted-media; picture-in-picture"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      </HudPanel>
    </div>
  )
}
