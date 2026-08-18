import * as os from 'os'
import { promises as fs } from 'fs'

// Read-only PC/system awareness built entirely on Node's os/fs APIs — no
// shell commands, no external processes, no native dependencies. Strictly
// observe → report. Sensors Node cannot reach (GPU load/temperature, CPU
// temperature) are reported as unavailable rather than guessed.

const SAMPLE_INTERVAL_MS = 120
export const SYSTEM_CACHE_TTL_MS = 5_000

export interface SystemStatus {
  cpuModel: string
  coreCount: number
  /** 0–100, averaged across cores since the previous sample */
  cpuUsagePercent: number
  ramTotalGb: number
  ramUsedGb: number
  ramUsedPercent: number
  diskTotalGb: number | null
  diskFreeGb: number | null
  diskUsedPercent: number | null
  uptimeHours: number
  platform: string
}

type CpuTimes = { idle: number; total: number }

function sampleCpuTimes(): CpuTimes {
  let idle = 0
  let total = 0
  for (const cpu of os.cpus()) {
    idle += cpu.times.idle
    for (const value of Object.values(cpu.times)) total += value
  }
  return { idle, total }
}

export function cpuUsageFromSamples(prev: CpuTimes, next: CpuTimes): number {
  const totalDelta = next.total - prev.total
  const idleDelta = next.idle - prev.idle
  if (totalDelta <= 0) return 0
  const usage = (1 - idleDelta / totalDelta) * 100
  return Math.min(100, Math.max(0, Math.round(usage)))
}

const toGb = (bytes: number): number => Math.round((bytes / 1024 ** 3) * 10) / 10

let previousCpu: CpuTimes | null = null
let cachedStatus: { at: number; status: SystemStatus } | null = null

export async function getSystemStatus(): Promise<SystemStatus> {
  if (cachedStatus && Date.now() - cachedStatus.at < SYSTEM_CACHE_TTL_MS) {
    return cachedStatus.status
  }

  // CPU usage needs two samples; reuse the previous call's sample when we
  // have one, otherwise take a short paired sample on first use.
  let prev = previousCpu
  if (!prev) {
    prev = sampleCpuTimes()
    await new Promise((resolve) => setTimeout(resolve, SAMPLE_INTERVAL_MS))
  }
  const next = sampleCpuTimes()
  const cpuUsagePercent = cpuUsageFromSamples(prev, next)
  previousCpu = next

  const ramTotal = os.totalmem()
  const ramUsed = ramTotal - os.freemem()

  let diskTotalGb: number | null = null
  let diskFreeGb: number | null = null
  let diskUsedPercent: number | null = null
  try {
    const stat = await fs.statfs(process.cwd())
    const total = stat.blocks * stat.bsize
    const free = stat.bavail * stat.bsize
    if (total > 0) {
      diskTotalGb = toGb(total)
      diskFreeGb = toGb(free)
      diskUsedPercent = Math.round(((total - free) / total) * 100)
    }
  } catch (error) {
    console.error('[system] disk stats unavailable', error)
  }

  const status: SystemStatus = {
    cpuModel: os.cpus()[0]?.model?.trim() || 'unknown CPU',
    coreCount: os.cpus().length,
    cpuUsagePercent,
    ramTotalGb: toGb(ramTotal),
    ramUsedGb: toGb(ramUsed),
    ramUsedPercent: Math.round((ramUsed / ramTotal) * 100),
    diskTotalGb,
    diskFreeGb,
    diskUsedPercent,
    uptimeHours: Math.round((os.uptime() / 3600) * 10) / 10,
    platform: process.platform
  }
  cachedStatus = { at: Date.now(), status }
  return status
}

export function formatSystemForPrompt(status: SystemStatus): string {
  const disk =
    status.diskUsedPercent === null
      ? 'disk stats unavailable'
      : `disk ${status.diskUsedPercent}% used (${status.diskFreeGb} GB free of ${status.diskTotalGb} GB)`
  return (
    `System status (read-only): CPU ${status.cpuUsagePercent}% (${status.coreCount} cores), ` +
    `RAM ${status.ramUsedPercent}% used (${status.ramUsedGb} of ${status.ramTotalGb} GB), ` +
    `${disk}, uptime ${status.uptimeHours} h. ` +
    'GPU load and temperature sensors are not accessible — if asked, say you cannot read ' +
    'them at the moment. Use these values for system questions; never fabricate readings.'
  )
}

/** Test hook: clear cached samples. */
export function resetSystemCache(): void {
  previousCpu = null
  cachedStatus = null
}
