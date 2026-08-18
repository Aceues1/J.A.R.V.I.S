import { describe, expect, it } from 'vitest'
import { formatTimeContext, getTimeInfo, timeOfDayForHour } from '../time'

describe('timeOfDayForHour', () => {
  it.each([
    [0, 'night'],
    [3, 'night'],
    [4, 'night'],
    [5, 'morning'],
    [9, 'morning'],
    [11, 'morning'],
    [12, 'afternoon'],
    [17, 'afternoon'],
    [18, 'evening'],
    [21, 'evening'],
    [23, 'evening']
  ])('classifies hour %i as %s', (hour, expected) => {
    expect(timeOfDayForHour(hour)).toBe(expected)
  })
})

describe('getTimeInfo', () => {
  it('derives everything from the given clock', () => {
    const info = getTimeInfo(new Date(2026, 7, 20, 14, 5)) // Thu 20 Aug 2026 14:05
    expect(info.weekday).toBe('Thursday')
    expect(info.date).toBe('20 August 2026')
    expect(info.time).toBe('14:05')
    expect(info.timeOfDay).toBe('afternoon')
    expect(info.isoDate).toBe('2026-08-20')
  })

  it('zero-pads times', () => {
    expect(getTimeInfo(new Date(2026, 0, 5, 7, 3)).time).toBe('07:03')
  })
})

describe('formatTimeContext', () => {
  it('renders a single compact line', () => {
    const line = formatTimeContext(new Date(2026, 7, 20, 21, 30))
    expect(line).toBe('Current local date and time: Thursday 20 August 2026, 21:30 (evening).')
  })
})
