import { formatTimeContext } from './time'
import { formatScheduleContext } from './schedule'
import { formatLocationContext } from './location'
import { formatSystemForPrompt, getSystemStatus } from './system'
import { getWeatherPromptContext } from '../weather'

// The JARVIS Awareness Layer: independent modules (time, schedule, location,
// system, weather) assembled into one compact context block for the chat
// system prompt. Each module fails independently — a failed line is replaced
// by an honest "unavailable" note and never takes the others down. The whole
// block is deliberately small (~150 tokens) so it can ride along on every
// request without bloating the prompt; weather reuses the existing cached
// Open-Meteo client, and system stats are cached for a few seconds.

export { getSystemStatus } from './system'
export type { SystemStatus } from './system'

type Section = { name: string; render: () => string | Promise<string> }

const SECTIONS: Section[] = [
  { name: 'time', render: () => formatTimeContext() },
  { name: 'location', render: () => formatLocationContext() },
  { name: 'schedule', render: () => formatScheduleContext() },
  { name: 'system', render: async () => formatSystemForPrompt(await getSystemStatus()) }
]

const FOOTER =
  'Use this awareness data — not model guesses — for questions about the current time, date, ' +
  'day, schedule, location, and system health. Summarize naturally; never recite the raw block.'

export async function getAwarenessContext(): Promise<string> {
  const lines: string[] = []
  for (const section of SECTIONS) {
    try {
      lines.push(await section.render())
    } catch (error) {
      console.error(`[awareness] ${section.name} module failed`, error)
      lines.push(`The ${section.name} awareness module is currently unavailable.`)
    }
  }

  // Weather keeps its own dedicated block (and its own failure note) so the
  // existing weather-answer contract is unchanged.
  let weather: string
  try {
    weather = await getWeatherPromptContext()
  } catch {
    weather = 'Live weather data is temporarily unavailable.'
  }

  return `# Awareness\n${lines.join('\n')}\n${FOOTER}\n\n${weather}`
}
