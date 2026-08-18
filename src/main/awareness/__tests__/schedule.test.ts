import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  formatScheduleContext,
  getScheduleInfo,
  parseScheduleConfig,
  resetScheduleCache
} from '../schedule'

// Thu 20 Aug 2026
const THURSDAY = new Date(2026, 7, 20, 9, 0)

const VALID = {
  week: {
    thursday: { working: true, start: '07:00', end: '15:00', label: 'day shift' },
    friday: { working: false, label: 'off rotation' }
  },
  overrides: {
    '2026-08-27': { working: false, label: 'vacation' }
  }
}

function writeSchedule(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'jarvis-schedule-'))
  const file = join(dir, 'schedule.json')
  writeFileSync(file, content)
  return file
}

beforeEach(() => resetScheduleCache())
afterEach(() => {
  vi.unstubAllEnvs()
  resetScheduleCache()
})

describe('parseScheduleConfig', () => {
  it('accepts the documented format', () => {
    expect(parseScheduleConfig(VALID)).not.toBeNull()
  })

  it.each([
    ['missing week', {}],
    ['non-boolean working', { week: { monday: { working: 'yes' } } }],
    ['bad override date', { week: {}, overrides: { 'aug 20': { working: false } } }],
    ['non-object', 'nope']
  ])('rejects %s', (_label, bad) => {
    expect(parseScheduleConfig(bad)).toBeNull()
  })
})

describe('getScheduleInfo', () => {
  it('reports a configured working day with hours and label', () => {
    vi.stubEnv('JARVIS_SCHEDULE_PATH', writeSchedule(JSON.stringify(VALID)))
    const info = getScheduleInfo(THURSDAY)
    expect(info.configured).toBe(true)
    expect(info.today).toMatchObject({ working: true, start: '07:00', end: '15:00' })
    expect(info.tomorrow).toMatchObject({ working: false, label: 'off rotation' })
  })

  it('treats days absent from the weekly pattern as days off', () => {
    vi.stubEnv(
      'JARVIS_SCHEDULE_PATH',
      writeSchedule(JSON.stringify({ week: { monday: { working: true } } }))
    )
    const info = getScheduleInfo(THURSDAY)
    expect(info.today?.working).toBe(false)
  })

  it('lets a date override beat the weekly pattern', () => {
    const withOverride = {
      week: { thursday: { working: true } },
      overrides: { '2026-08-20': { working: false, label: 'vacation' } }
    }
    vi.stubEnv('JARVIS_SCHEDULE_PATH', writeSchedule(JSON.stringify(withOverride)))
    expect(getScheduleInfo(THURSDAY).today).toMatchObject({ working: false, label: 'vacation' })
  })

  it('reports not configured when no file exists', () => {
    vi.stubEnv('JARVIS_SCHEDULE_PATH', join(tmpdir(), 'jarvis-definitely-missing.json'))
    expect(getScheduleInfo(THURSDAY)).toEqual({ configured: false })
  })

  it('treats an invalid file as not configured without throwing', () => {
    vi.stubEnv('JARVIS_SCHEDULE_PATH', writeSchedule('{not json'))
    expect(getScheduleInfo(THURSDAY)).toEqual({ configured: false })
  })
})

describe('formatScheduleContext', () => {
  it('summarizes today and tomorrow when configured', () => {
    vi.stubEnv('JARVIS_SCHEDULE_PATH', writeSchedule(JSON.stringify(VALID)))
    const line = formatScheduleContext(THURSDAY)
    expect(line).toContain('today Thursday — work 07:00–15:00 (day shift)')
    expect(line).toContain('tomorrow Friday — day off (off rotation)')
  })

  it('instructs honesty when not configured', () => {
    vi.stubEnv('JARVIS_SCHEDULE_PATH', join(tmpdir(), 'jarvis-definitely-missing.json'))
    const line = formatScheduleContext(THURSDAY)
    expect(line).toContain('not configured')
    expect(line).toContain('never invent one')
  })
})
