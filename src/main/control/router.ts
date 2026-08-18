import { parseActionReply, type ActionEnvelope } from './intent'
import { launchApp, resolveApp, type ActionResult } from './apps'
import { openWebsite, resolveWebsite } from './websites'
import { analyzeScreens, type ScreenImage } from '../vision'
import { GroqConfigError, GroqRequestError } from '../groq'
import { YouTubeError, searchYouTube } from '../youtube'

// Playback happens in the renderer's embedded player; the router attaches a
// directive to the chat result and the renderer executes it. The directive
// is only attached when the underlying action truly succeeded.
export type PlayerDirective =
  | { kind: 'load'; videoId: string; title?: string }
  | { kind: 'pause' }
  | { kind: 'play' }
  | { kind: 'volume'; value: number }

export interface RoutedReply {
  text: string
  player?: PlayerDirective
}

// Routes a model reply through the action pipeline:
//   reply → envelope parse → canonical intent → allowlisted executor →
//   truthful result → final JARVIS text.
// A plain conversational reply passes straight through. The final text is
// built from the REAL executor result — a "say" line from the model is used
// only when the action actually succeeded.

type ScreenCapturer = () => Promise<ScreenImage[]>

let captureScreens: ScreenCapturer | null = null

/** Called from the main process with the desktopCapturer-backed capturer. */
export function registerScreenCapturer(capturer: ScreenCapturer): void {
  captureScreens = capturer
}

async function executeOpenApp(envelope: ActionEnvelope): Promise<string> {
  const app = resolveApp(envelope.target)
  if (!app) {
    return (
      `I don't have "${envelope.target ?? 'that application'}" in my application registry, sir. ` +
      'It can be added to apps.json.'
    )
  }
  const result: ActionResult = await launchApp(app)
  if (result.ok) {
    return envelope.say || `Opening ${app.name}, sir.`
  }
  return `I wasn't able to open ${app.name}, sir. ${result.message}`
}

async function executeOpenWebsite(envelope: ActionEnvelope): Promise<string> {
  const site = resolveWebsite(envelope.target)
  if (!site) {
    return (
      `I can't open "${envelope.target ?? 'that site'}", sir — it isn't on my approved ` +
      'website list.'
    )
  }
  const result = await openWebsite(site)
  if (result.ok) {
    return envelope.say || `Opening ${site.name}, sir.`
  }
  return `I wasn't able to open ${site.name}, sir. ${result.message}`
}

async function executeAnalyzeScreen(question: string): Promise<string> {
  if (!captureScreens) {
    return "I wasn't able to capture the screen, sir — screen capture isn't available."
  }
  let screens: ScreenImage[]
  try {
    screens = await captureScreens()
  } catch (error) {
    console.error('[control] screen capture failed', error)
    return "I wasn't able to capture the screen, sir."
  }
  if (screens.length === 0) {
    return "I wasn't able to capture the screen, sir."
  }

  try {
    return await analyzeScreens(question, screens)
  } catch (error) {
    if (error instanceof GroqConfigError || error instanceof GroqRequestError) {
      return `I couldn't complete the screen analysis, sir. ${error.message}`
    }
    console.error('[control] vision analysis failed', error)
    return "I couldn't complete the screen analysis, sir."
  }
}

async function executePlayVideo(envelope: ActionEnvelope): Promise<RoutedReply> {
  try {
    const video = await searchYouTube(envelope.target ?? '')
    return {
      text: envelope.say || 'Found one, sir.',
      player: { kind: 'load', videoId: video.videoId, title: video.title }
    }
  } catch (error) {
    if (error instanceof YouTubeError) {
      if (/reached|timed out/i.test(error.message)) {
        return { text: "I'm unable to reach YouTube at the moment, sir." }
      }
      if (/no playable result|no search topic/i.test(error.message)) {
        return { text: "I couldn't identify a playable result, sir." }
      }
      return { text: `I wasn't able to find a suitable video, sir. ${error.message}` }
    }
    console.error('[control] video search failed', error)
    return { text: "I wasn't able to find a suitable video, sir." }
  }
}

function executeSetVolume(envelope: ActionEnvelope): RoutedReply {
  // Accept the numeric envelope field, or a bare number in target.
  const raw =
    envelope.volume ??
    (envelope.target && Number.isFinite(Number(envelope.target)) ? Number(envelope.target) : NaN)
  if (!Number.isFinite(raw)) {
    return { text: 'The volume needs to be a number between 0 and 100, sir.' }
  }
  const value = Math.max(0, Math.min(100, Math.round(raw)))
  return { text: envelope.say || `Volume set to ${value}, sir.`, player: { kind: 'volume', value } }
}

/**
 * Post-processes a model reply. Returns the text to show/speak — either the
 * reply itself (normal conversation) or the truthful outcome of the action
 * it requested — plus an optional player directive for the renderer.
 * `lastUserMessage` gives screen analysis its question.
 */
export async function routeReply(reply: string, lastUserMessage: string): Promise<RoutedReply> {
  const parsed = parseActionReply(reply)
  if (!parsed) return { text: reply }

  if ('unsupported' in parsed) {
    console.error('[control] unsupported action requested by model:', parsed.unsupported)
    return { text: "I'm afraid that action isn't supported yet, sir." }
  }

  const { envelope } = parsed
  switch (envelope.action) {
    case 'open_app':
      return { text: await executeOpenApp(envelope) }
    case 'open_website':
      return { text: await executeOpenWebsite(envelope) }
    case 'analyze_screen':
      return { text: await executeAnalyzeScreen(lastUserMessage) }
    case 'play_video':
      return executePlayVideo(envelope)
    case 'pause_video':
      return { text: envelope.say || 'Pausing the video, sir.', player: { kind: 'pause' } }
    case 'resume_video':
      return { text: envelope.say || 'Resuming, sir.', player: { kind: 'play' } }
    case 'set_volume':
      return executeSetVolume(envelope)
  }
}
