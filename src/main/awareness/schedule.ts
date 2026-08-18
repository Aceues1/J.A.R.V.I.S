import { readFileSync, statSync } from 'fs'
import { join } from 'path'

// Work/turnus awareness from a local, explicit configuration file — no
// calendar integration yet. The file is a weekly pattern plus optional
// per-date overrides (see jarvis.schedule.example.json). If no valid file
// exists, the schedule is simply "not configured" and JARVIS must say so
// rather than inventing one.
//
// File location: JARVIS_SCHEDULE_PATH, or jarvis.schedule.json in the
// working directory.

const WEEKDAY_KEYS = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday'
] as const

export interface ScheduleDay {
  working: boolean
  start?: string
  end?: string
  label?: string
}

interface ScheduleConfig {
  week: Partial<Record<(typeof WEEKDAY_KEYS)[number], ScheduleDay>>
  overrides: Record<string, ScheduleDay>
}

export interface ScheduleInfo {
  configured: boolean
  today?: ScheduleDay & { weekday: string }
  tomorrow?: ScheduleDay & { weekday: string }
}

const TIME_RE = /^\d{2}:\d{2}$/

function parseDay(value: unknown): ScheduleDay | null {
  if (typeof value !== 'object' || value === null) return null
  const { working, start, end, label } = value as Record<string, unknown>
  if (typeof working !== 'boolean') return null
  const day: ScheduleDay = { working }
  if (typeof start === 'string' && TIME_RE.test(start)) day.start = start
  if (typeof end === 'string' && TIME_RE.test(end)) day.end = end
  if (typeof label === 'string' && label.length <= 60) day.label = label
  return day
}

export function parseScheduleConfig(raw: unknown): ScheduleConfig | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { week, overrides } = raw as { week?: unknown; overrides?: unknown }
  if (typeof week !== 'object' || week === null) return null

  const config: ScheduleConfig = { week: {}, overrides: {} }
  for (const key of WEEKDAY_KEYS) {
    const entry = (week as Record<string, unknown>)[key]
    if (entry !== undefined) {
      const day = parseDay(entry)
      if (!day) return null
      config.week[key] = day
    }
  }
  if (overrides !== undefined) {
    if (typeof overrides !== 'object' || overrides === null) return null
    for (const [date, entry] of Object.entries(overrides)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
      const day = parseDay(entry)
      if (!day) return null
      config.overrides[date] = day
    }
  }
  return config
}

let cached: { path: string; mtimeMs: number; config: ScheduleConfig | null } | null = null

function schedulePath(): string {
  return process.env.JARVIS_SCHEDULE_PATH || join(process.cwd(), 'jarvis.schedule.json')
}

function loadScheduleConfig(): ScheduleConfig | null {
  const path = schedulePath()
  let mtimeMs: number
  try {
    mtimeMs = statSync(path).mtimeMs
  } catch {
    cached = null
    return null // no file — schedule simply not configured
  }

  if (cached && cached.path === path && cached.mtimeMs === mtimeMs) {
    return cached.config
  }

  let config: ScheduleConfig | null = null
  try {
    config = parseScheduleConfig(JSON.parse(readFileSync(path, 'utf8')))
    if (!config) console.error('[schedule] invalid schedule file, treating as not configured')
  } catch (error) {
    console.error('[schedule] could not read schedule file', error)
  }
  cached = { path, mtimeMs, config }
  return config
}

function dayFor(config: ScheduleConfig, date: Date): ScheduleDay & { weekday: string } {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const iso = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  const weekdayKey = WEEKDAY_KEYS[date.getDay()]
  const weekday = weekdayKey.charAt(0).toUpperCase() + weekdayKey.slice(1)
  // A day absent from the weekly pattern counts as a day off (the file lists
  // working days); a date override wins over the weekly pattern.
  const base = config.overrides[iso] ?? config.week[weekdayKey] ?? { working: false }
  return { ...base, weekday }
}

export function getScheduleInfo(now: Date = new Date()): ScheduleInfo {
  const config = loadScheduleConfig()
  if (!config) return { configured: false }

  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  return {
    configured: true,
    today: dayFor(config, now),
    tomorrow: dayFor(config, tomorrow)
  }
}

function describeDay(day: ScheduleDay & { weekday: string }): string {
  if (!day.working) {
    return `${day.weekday} — day off${day.label ? ` (${day.label})` : ''}`
  }
  const hours = day.start && day.end ? ` ${day.start}–${day.end}` : ''
  return `${day.weekday} — work${hours}${day.label ? ` (${day.label})` : ''}`
}

export function formatScheduleContext(now: Date = new Date()): string {
  const info = getScheduleInfo(now)
  if (!info.configured || !info.today || !info.tomorrow) {
    return (
      "Work schedule: not configured. If asked about the user's schedule or work days, say " +
      "you don't have their schedule configured yet — never invent one."
    )
  }
  return `Work schedule: today ${describeDay(info.today)}; tomorrow ${describeDay(info.tomorrow)}.`
}

/** Test hook: clear the schedule file cache. */
export function resetScheduleCache(): void {
  cached = null
}
