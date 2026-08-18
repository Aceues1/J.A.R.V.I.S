// Action-intent layer for computer control. The model never emits commands —
// only a strict JSON envelope naming one supported action and a registry
// target. This module parses that envelope out of a model reply and
// normalizes the many phrasings a model may use ("open app", "launch
// application", …) into ONE canonical action, so the router never silently
// drops a slightly-differently-worded command.

export type CanonicalAction = 'open_app' | 'open_website' | 'analyze_screen'

export interface ActionEnvelope {
  action: CanonicalAction
  target?: string
  say?: string
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
    const { action, target, say } = parsed as Record<string, unknown>
    if (typeof action !== 'string') return null
    return {
      action,
      target: typeof target === 'string' ? target.slice(0, 200) : undefined,
      say: typeof say === 'string' ? say.slice(0, 300) : undefined
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
  return { envelope: { action, target: raw.target, say: raw.say } }
}
