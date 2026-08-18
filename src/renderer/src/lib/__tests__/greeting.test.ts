import { describe, expect, it } from 'vitest'
import { buildStartupGreeting } from '../greeting'

describe('buildStartupGreeting', () => {
  it.each([
    [5, 'Good morning, sir.'],
    [8, 'Good morning, sir.'],
    [11, 'Good morning, sir.'],
    [12, 'Good afternoon, sir.'],
    [17, 'Good afternoon, sir.'],
    [18, 'Good evening, sir.'],
    [21, 'Good evening, sir.'],
    [23, 'Good evening, sir.']
  ])('at hour %i greets with %s', (hour, prefix) => {
    expect(buildStartupGreeting(hour)).toBe(
      `${prefix} All systems are online. How may I assist you?`
    )
  })

  it('never says "Good evening" in the middle of the night', () => {
    for (const hour of [0, 1, 2, 3, 4]) {
      const greeting = buildStartupGreeting(hour)
      expect(greeting).not.toContain('Good evening')
      expect(greeting).toBe("You're up late, sir. All systems are online. How may I assist you?")
    }
  })

  it('always keeps the systems-online tail', () => {
    for (let hour = 0; hour < 24; hour++) {
      expect(buildStartupGreeting(hour)).toContain('All systems are online. How may I assist you?')
    }
  })
})
