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

  // The sessions flush (users/services/sessions.service.ts) drains each
  // task's own memory, so it stays an @Interval.
  it("registers the app's intervals", () => {
    const registry = service.app.get(SchedulerRegistry)

    expect(registry.getIntervals().length).toBeGreaterThan(0)
  })
})
