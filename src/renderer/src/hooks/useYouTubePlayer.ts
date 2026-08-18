import { useCallback, useEffect, useRef, useState } from 'react'
import type { PlayerDirective } from '@renderer/types/hud'
import {
  YOUTUBE_COMMAND_DELAY_MS,
  YOUTUBE_EMBED_ORIGIN,
  buildEmbedUrl,
  buildPlayerCommand,
  isValidVideoId,
  type PlayerFunc
} from '@renderer/lib/youtube'

export type PlayerStatus = 'hidden' | 'loading' | 'playing' | 'paused' | 'error'

export interface PlayerEvent {
  kind: 'loaded' | 'command' | 'ignored' | 'failed'
  detail: string
}

interface UseYouTubePlayerResult {
  status: PlayerStatus
  videoId: string | null
  title: string | null
  embedUrl: string | null
  iframeRef: React.RefObject<HTMLIFrameElement | null>
  /** Wire to the iframe's onLoad — starts the mandatory 700ms settle timer. */
  handleIframeLoad: () => void
  handleDirective: (directive: PlayerDirective) => void
  close: () => void
}

export function useYouTubePlayer(onEvent?: (event: PlayerEvent) => void): UseYouTubePlayerResult {
  const [status, setStatus] = useState<PlayerStatus>('hidden')
  const [videoId, setVideoId] = useState<string | null>(null)
  const [title, setTitle] = useState<string | null>(null)
  const [embedUrl, setEmbedUrl] = useState<string | null>(null)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const readyRef = useRef(false)
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Commands issued while the player is still settling run after the delay.
  const pendingRef = useRef<Array<{ func: PlayerFunc; args: Array<number | string> }>>([])
  const onEventRef = useRef(onEvent)
  useEffect(() => {
    onEventRef.current = onEvent
  }, [onEvent])

  useEffect(
    () => () => {
      if (settleTimerRef.current) clearTimeout(settleTimerRef.current)
    },
    []
  )

  const postCommand = useCallback((func: PlayerFunc, args: Array<number | string> = []) => {
    const frame = iframeRef.current
    if (!frame?.contentWindow) return
    // Commands go only to the YouTube embed origin — never '*'.
    frame.contentWindow.postMessage(buildPlayerCommand(func, args), YOUTUBE_EMBED_ORIGIN)
    onEventRef.current?.({ kind: 'command', detail: `${func}(${args.join(', ')})` })
  }, [])

  const sendWhenReady = useCallback(
    (func: PlayerFunc, args: Array<number | string> = []) => {
      if (readyRef.current) {
        postCommand(func, args)
      } else {
        pendingRef.current.push({ func, args })
      }
    },
    [postCommand]
  )

  const handleIframeLoad = useCallback(() => {
    // The guide's mandatory settle delay: the embedded player drops commands
    // sent immediately after load. Do not remove.
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current)
    settleTimerRef.current = setTimeout(() => {
      readyRef.current = true
      for (const { func, args } of pendingRef.current) postCommand(func, args)
      pendingRef.current = []
      // autoplay=1 starts playback; nudge explicitly in case autoplay policy
      // held it back.
      postCommand('playVideo')
      setStatus('playing')
      onEventRef.current?.({ kind: 'loaded', detail: 'Player ready' })
    }, YOUTUBE_COMMAND_DELAY_MS)
  }, [postCommand])

  const handleDirective = useCallback(
    (directive: PlayerDirective) => {
      switch (directive.kind) {
        case 'load': {
          if (!isValidVideoId(directive.videoId)) {
            onEventRef.current?.({ kind: 'failed', detail: 'Invalid video id from backend' })
            setStatus('error')
            return
          }
          // One active player: a new load replaces the current video.
          readyRef.current = false
          pendingRef.current = []
          if (settleTimerRef.current) clearTimeout(settleTimerRef.current)
          setVideoId(directive.videoId)
          setTitle(directive.title ?? null)
          setEmbedUrl(buildEmbedUrl(directive.videoId))
          setStatus('loading')
          return
        }
        case 'pause':
          if (status === 'hidden') {
            onEventRef.current?.({ kind: 'ignored', detail: 'No video is playing' })
            return
          }
          sendWhenReady('pauseVideo')
          setStatus('paused')
          return
        case 'play':
          if (status === 'hidden') {
            onEventRef.current?.({ kind: 'ignored', detail: 'No video is playing' })
            return
          }
          sendWhenReady('playVideo')
          setStatus('playing')
          return
        case 'volume': {
          if (status === 'hidden') {
            onEventRef.current?.({ kind: 'ignored', detail: 'No video is playing' })
            return
          }
          const value = Math.max(0, Math.min(100, Math.round(directive.value)))
          sendWhenReady('setVolume', [value])
          return
        }
      }
    },
    [sendWhenReady, status]
  )

  const close = useCallback(() => {
    readyRef.current = false
    pendingRef.current = []
    if (settleTimerRef.current) clearTimeout(settleTimerRef.current)
    setStatus('hidden')
    setVideoId(null)
    setTitle(null)
    setEmbedUrl(null)
  }, [])

  return { status, videoId, title, embedUrl, iframeRef, handleIframeLoad, handleDirective, close }
}
