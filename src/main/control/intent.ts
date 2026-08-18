// Action-intent layer for computer control. The model never emits commands —
// only a strict JSON envelope naming one supported action and a registry
// target. This module parses that envelope out of a model reply and
// normalizes the many phrasings a model may use ("open app", "launch
// application", …) into ONE canonical action, so the router never silently
// drops a slightly-differently-worded command.

export type CanonicalAction =
  | 'open_app'
  | 'open_website'
  | 'analyze_screen'
  | 'play_video'
  | 'pause_video'
  | 'resume_video'
  | 'set_volume'
  | 'play_music'
  | 'pause_music'
  | 'resume_music'
  | 'next_track'
  | 'previous_track'
  | 'music_volume_up'
  | 'music_volume_down'

export interface ActionEnvelope {
  action: CanonicalAction
  target?: string
  say?: string
  volume?: number
}

const ACTION_SYNONYMS: Record<CanonicalAction, string[]> = {
  open_app: [
    'open_app',
    'openapp',
    'open_application',
    'launch_app',
    'launch_application',
    'start_app',
    'start_application',
    'run_app',
    'open_program',
    'launch_program',
    'start_program'
  ],
  open_website: [
    'open_website',
    'openwebsite',
    'open_site',
    'open_url',
    'open_link',
    'open_page',
    'launch_website',
    'visit_website',
    'browse',
    'browse_web',
    'browse_the_web',
    'open_browser',
    'launch_browser'
  ],
  analyze_screen: [
    'analyze_screen',
    'analyse_screen',
    'analyzescreen',
    'screen_analysis',
    'look_at_screen',
    'look_at_my_screen',
    'view_screen',
    'read_screen',
    'describe_screen',
    'capture_screen',
    'screenshot',
    'see_screen'
  ],
  play_video: [
    'play_video',
    'playvideo',
    'play_a_video',
    'play_youtube',
    'play_youtube_video',
    'find_video',
    'find_a_video',
    'search_video',
    'video_about',
    'youtube_video'
  ],
  pause_video: ['pause_video', 'pausevideo', 'pause', 'pause_playback', 'pause_the_video'],
  resume_video: [
    'resume_video',
    'resumevideo',
    'resume',
    'resume_playback',
    'continue_video',
    'continue',
    'unpause',
    'unpause_video',
    'play_again'
  ],
  set_volume: ['set_volume', 'setvolume', 'volume', 'change_volume', 'adjust_volume'],
  play_music: [
    'play_music',
    'playmusic',
    'play_song',
    'play_track',
    'play_a_song',
    'spotify_play',
    'play_spotify',
    'play_on_spotify',
    'spotify'
  ],
  pause_music: ['pause_music', 'pause_song', 'pause_spotify', 'spotify_pause', 'pause_the_music'],
  resume_music: [
    'resume_music',
    'resume_song',
    'resume_spotify',
    'spotify_resume',
    'unpause_music',
    'continue_music',
    'resume_the_music'
  ],
  next_track: ['next_track', 'next_song', 'next', 'skip', 'skip_track', 'skip_song', 'skip_this'],
  previous_track: [
    'previous_track',
    'previous_song',
    'previous',
    'prev',
    'prev_track',
    'last_song',
    'go_back_a_song'
  ],
  music_volume_up: [
    'music_volume_up',
    'volume_up',
    'turn_it_up',
    'turn_up_the_volume',
    'louder',
    'spotify_volume_up'
  ],
  music_volume_down: [
    'music_volume_down',
    'volume_down',
    'turn_it_down',
    'turn_down_the_volume',
    'quieter',
    'spotify_volume_down'
  ]
}

export function canonIntent(raw: unknown): CanonicalAction | null {
  if (typeof raw !== 'string') return null
  // "Open App", "launch-application", "analyze screen" → one canonical form
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_')
  for (const [canonical, synonyms] of Object.entries(ACTION_SYNONYMS)) {
    if (synonyms.includes(normalized)) return canonical as CanonicalAction
  }
  return null
}

interface RawEnvelope {
  action: string
  target?: string
  say?: string
  volume?: number
}

function extractJson(reply: string): RawEnvelope | null {
  const trimmed = reply.trim()
  // Accept the bare envelope, or one wrapped in a markdown code fence.
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  const candidate = (fenced ? fenced[1] : trimmed).trim()
  if (!candidate.startsWith('{') || !candidate.endsWith('}')) return null

  try {
    const parsed = JSON.parse(candidate)
    if (typeof parsed !== 'object' || parsed === null) return null
    const { action, target, say, volume } = parsed as Record<string, unknown>
    if (typeof action !== 'string') return null
    // Volume arrives as a number or numeric string; anything else is dropped
    // here and rejected downstream.
    const numericVolume =
      typeof volume === 'number'
        ? volume
        : typeof volume === 'string' && volume.trim() !== '' && Number.isFinite(Number(volume))
          ? Number(volume)
          : undefined
    return {
      action,
      target: typeof target === 'string' ? target.slice(0, 200) : undefined,
      say: typeof say === 'string' ? say.slice(0, 300) : undefined,
      volume: numericVolume
    }
  } catch {
    return null
  }
}

/**
 * Returns the parsed action when the model's reply is an action envelope.
 * `unsupported: true` marks a well-formed envelope whose action isn't one of
 * ours — the router answers with a clean failure instead of dropping it.
 */
export function parseActionReply(
  reply: string
): { envelope: ActionEnvelope } | { unsupported: string } | null {
  const raw = extractJson(reply)
  if (!raw) return null

  const action = canonIntent(raw.action)
  if (!action) return { unsupported: raw.action }
  return { envelope: { action, target: raw.target, say: raw.say, volume: raw.volume } }
}
