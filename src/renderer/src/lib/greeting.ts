// Time-aware startup greeting. Mirrors the main process's time-of-day bands
// (src/main/awareness/time.ts); duplicated as a tiny pure function because
// the greeting is composed in the renderer and needs no IPC round trip.

const GREETING_TAIL = 'All systems are online. How may I assist you?'

export function buildStartupGreeting(hour: number = new Date().getHours()): string {
  if (hour >= 5 && hour < 12) return `Good morning, sir. ${GREETING_TAIL}`
  if (hour >= 12 && hour < 18) return `Good afternoon, sir. ${GREETING_TAIL}`
  if (hour >= 18) return `Good evening, sir. ${GREETING_TAIL}`
  // 00:00–04:59 — "Good evening" would sound wrong; keep it natural.
  return `You're up late, sir. ${GREETING_TAIL}`
}
