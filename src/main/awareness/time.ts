// Time awareness: everything derives from the local system clock, never from
// model knowledge. Pure functions over an injectable Date for testability.

export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night'

export function timeOfDayForHour(hour: number): TimeOfDay {
  if (hour >= 5 && hour < 12) return 'morning'
  if (hour >= 12 && hour < 18) return 'afternoon'
  if (hour >= 18) return 'evening'
  return 'night'
}

export interface TimeInfo {
  weekday: string
  date: string
  time: string
  timeOfDay: TimeOfDay
  isoDate: string
}

export function getTimeInfo(now: Date = new Date()): TimeInfo {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return {
    weekday: now.toLocaleDateString('en-GB', { weekday: 'long' }),
    date: now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    timeOfDay: timeOfDayForHour(now.getHours()),
    isoDate: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  }
}

export function formatTimeContext(now: Date = new Date()): string {
  const info = getTimeInfo(now)
  return `Current local date and time: ${info.weekday} ${info.date}, ${info.time} (${info.timeOfDay}).`
}
