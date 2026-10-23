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

  it("registers the app's cron jobs", () => {
    const registry = service.app.get(SchedulerRegistry)

    expect(registry.doesExist('cron', 'pollReviewOverdue')).toBe(true)
  })
})
