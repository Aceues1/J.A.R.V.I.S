import { parseActionReply, type ActionEnvelope } from './intent'
import { launchApp, resolveApp, type ActionResult } from './apps'
import { openWebsite, resolveWebsite } from './websites'
import { analyzeScreens, type ScreenImage } from '../vision'
import { GroqConfigError, GroqRequestError } from '../groq'

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

/**
 * Post-processes a model reply. Returns the text to show/speak — either the
 * reply itself (normal conversation) or the truthful outcome of the action
 * it requested. `lastUserMessage` gives screen analysis its question.
 */
export async function routeReply(reply: string, lastUserMessage: string): Promise<string> {
  const parsed = parseActionReply(reply)
  if (!parsed) return reply

  if ('unsupported' in parsed) {
    console.error('[control] unsupported action requested by model:', parsed.unsupported)
    return "I'm afraid that action isn't supported yet, sir."
  }

  const { envelope } = parsed
  switch (envelope.action) {
    case 'open_app':
      return executeOpenApp(envelope)
    case 'open_website':
      return executeOpenWebsite(envelope)
    case 'analyze_screen':
      return executeAnalyzeScreen(lastUserMessage)
  }
}
