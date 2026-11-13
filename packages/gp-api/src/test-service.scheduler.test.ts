import { SchedulerRegistry } from '@nestjs/schedule'
import { describe, expect, it } from 'vitest'
import { useTestService } from './test-service'

describe('useTestService', () => {
  const service = useTestService()

  it('registers no cron, interval or timeout', () => {
    const registry = service.app.get(SchedulerRegistry)

    expect(registry.getCronJobs().size).toBe(0)
    expect(registry.getIntervals()).toEqual([])
    expect(registry.getTimeouts()).toEqual([])
  })
})

describe('useTestService({ scheduler: true })', () => {
  const service = useTestService({ scheduler: true })

  // The startup hooks (@Timeout(0)) are the only @nestjs/schedule jobs left.
  it("registers the app's timeouts", () => {
    const registry = service.app.get(SchedulerRegistry)

    expect(registry.getTimeouts().length).toBeGreaterThan(0)
  })
})
