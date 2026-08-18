import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAwarenessContext } from '../index'
import { resetScheduleCache } from '../schedule'
import { resetSystemCache } from '../system'
import { resetWeatherCache } from '../../weather'

const weatherEntry = {
  current: {
    temperature_2m: 12.4,
    apparent_temperature: 9.6,
    weather_code: 3,
    wind_speed_10m: 6.2
  },
  daily: { temperature_2m_max: [14.2], temperature_2m_min: [7.8] }
}

beforeEach(() => {
  resetScheduleCache()
  resetSystemCache()
  resetWeatherCache()
  // No schedule file, no location, by default
  vi.stubEnv('JARVIS_SCHEDULE_PATH', join(tmpdir(), 'jarvis-nope.json'))
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

function mockWeatherFetch(ok: boolean): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(() =>
      ok
        ? Promise.resolve({
            ok: true,
            status: 200,
            text: () => Promise.resolve(''),
            json: () => Promise.resolve([weatherEntry, weatherEntry])
          })
        : Promise.reject(new TypeError('fetch failed'))
    )
  )
}

describe('getAwarenessContext', () => {
  it('assembles time, location, schedule, system, and weather sections', async () => {
    vi.stubEnv('JARVIS_LOCATION', 'Trondheim')
    mockWeatherFetch(true)
    const context = await getAwarenessContext()

    expect(context).toContain('# Awareness')
    expect(context).toMatch(/Current local date and time: \w+ \d+ \w+ \d{4}, \d{2}:\d{2}/)
    expect(context).toContain('configured current location is Trondheim')
    expect(context).toContain('Work schedule: not configured')
    expect(context).toMatch(/System status \(read-only\): CPU \d+%/)
    expect(context).toContain('# Live weather feed')
    expect(context).toContain('Sistranda / Frøya: 12°C')
    expect(context).toContain('never recite the raw block')
  })

  it('keeps time, schedule, location and system awareness when weather fails', async () => {
    mockWeatherFetch(false)
    const context = await getAwarenessContext()

    expect(context).toMatch(/Current local date and time/)
    expect(context).toMatch(/System status \(read-only\): CPU \d+%/)
    expect(context).toContain('Location: not configured')
    expect(context).toContain('temporarily unavailable')
    expect(context).not.toContain('°C),')
  })

  it('stays compact enough to ride on every request', async () => {
    mockWeatherFetch(true)
    const context = await getAwarenessContext()
    expect(context.length).toBeLessThan(2200)
  })
})
