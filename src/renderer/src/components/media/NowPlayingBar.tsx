import { cn } from '@renderer/lib/cn'

export interface NowPlayingState {
  isPlaying: boolean
  trackName: string | null
  artists: string[]
  deviceName: string | null
  volumePercent: number | null
}

interface NowPlayingBarProps {
  state: NowPlayingState | null
}

/**
 * Slim Spotify now-playing strip in the HUD style. Hidden entirely until the
 * main process pushes a playback state with a track — no dead chrome.
 */
export function NowPlayingBar({ state }: NowPlayingBarProps): React.JSX.Element | null {
  if (!state || !state.trackName) return null

  return (
    <div className="shrink-0 px-6 pt-2" data-testid="now-playing">
      <div className="flex items-center gap-3 border border-cyan-dim/40 bg-void-deep/60 px-3 py-1.5">
        <span
          className={cn(
            'h-2 w-2 shrink-0 rounded-full',
            state.isPlaying ? 'animate-pulse bg-cyan' : 'bg-warn'
          )}
        />
        <span className="font-mono text-[10px] tracking-[0.25em] text-ink-dim uppercase">
          Spotify
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink">
          {state.trackName}
          {state.artists.length > 0 && (
            <span className="text-ink-dim"> — {state.artists.join(', ')}</span>
          )}
        </span>
        <span className="hidden shrink-0 font-mono text-[10px] text-ink-dim sm:inline">
          {state.isPlaying ? 'PLAYING' : 'PAUSED'}
          {state.deviceName ? ` · ${state.deviceName}` : ''}
          {state.volumePercent !== null ? ` · ${state.volumePercent}%` : ''}
        </span>
      </div>
    </div>
  )
}
