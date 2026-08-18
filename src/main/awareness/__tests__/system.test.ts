import { beforeEach, describe, expect, it } from 'vitest'
import {
  cpuUsageFromSamples,
  formatSystemForPrompt,
  getSystemStatus,
  resetSystemCache,
  type SystemStatus
} from '../system'

beforeEach(() => resetSystemCache())

describe('cpuUsageFromSamples', () => {
  it('computes busy percentage from idle/total deltas', () => {
    expect(cpuUsageFromSamples({ idle: 100, total: 200 }, { idle: 150, total: 400 })).toBe(75)
  })

  it('clamps to 0..100 and survives zero deltas', () => {
    expect(cpuUsageFromSamples({ idle: 0, total: 0 }, { idle: 0, total: 0 })).toBe(0)
    expect(cpuUsageFromSamples({ idle: 100, total: 100 }, { idle: 300, total: 200 })).toBe(0)
  })
})

describe('getSystemStatus', () => {
  it('returns real, sane readings', async () => {
    const status = await getSystemStatus()
    expect(status.coreCount).toBeGreaterThan(0)
    expect(status.cpuUsagePercent).toBeGreaterThanOrEqual(0)
    expect(status.cpuUsagePercent).toBeLessThanOrEqual(100)
    expect(status.ramTotalGb).toBeGreaterThan(0)
    expect(status.ramUsedGb).toBeGreaterThan(0)
    expect(status.ramUsedGb).toBeLessThanOrEqual(status.ramTotalGb)
    expect(status.ramUsedPercent).toBeGreaterThan(0)
    expect(status.uptimeHours).toBeGreaterThanOrEqual(0)
    // Disk stats come from fs.statfs and should exist on this platform
    expect(status.diskTotalGb).not.toBeNull()
    expect(status.diskUsedPercent).toBeGreaterThanOrEqual(0)
  })

  it('serves cached values within the TTL', async () => {
    const first = await getSystemStatus()
    const second = await getSystemStatus()
    expect(second).toBe(first)
  })
})

describe('formatSystemForPrompt', () => {
  const base: SystemStatus = {
    cpuModel: 'Test CPU',
    coreCount: 12,
    cpuUsagePercent: 18,
    ramTotalGb: 32,
    ramUsedGb: 13.4,
    ramUsedPercent: 42,
    diskTotalGb: 953.9,
    diskFreeGb: 312.2,
    diskUsedPercent: 67,
    uptimeHours: 6.2,
    platform: 'win32'
  }

  it('renders a compact line with all key readings', () => {
    const line = formatSystemForPrompt(base)
    expect(line).toContain('CPU 18% (12 cores)')
    expect(line).toContain('RAM 42% used (13.4 of 32 GB)')
    expect(line).toContain('disk 67% used (312.2 GB free of 953.9 GB)')
    expect(line).toContain('uptime 6.2 h')
    expect(line).toContain('never fabricate readings')
  })

  it('reports unavailable disk sensors honestly', () => {
    const line = formatSystemForPrompt({
      ...base,
      diskTotalGb: null,
      diskFreeGb: null,
      diskUsedPercent: null
    })
    expect(line).toContain('disk stats unavailable')
  })

  it('declares GPU/temperature sensors inaccessible', () => {
    expect(formatSystemForPrompt(base)).toContain(
      'GPU load and temperature sensors are not accessible'
    )
  })
})
