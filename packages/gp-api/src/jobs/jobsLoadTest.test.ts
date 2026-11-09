import { describe, expect, it } from 'vitest'
import { useTestService } from '@/test-service'
import { JobsService } from './jobs.service'

const service = useTestService({ jobs: true })

describe('jobsLoadTest', () => {
  it('sleeps for its seconds, then completes', async () => {
    const jobs = service.app.get(JobsService)
    const startedAt = Date.now()
    for (let i = 0; i < 3; i++) {
      await jobs.send('jobsLoadTest', { seconds: 1 })
    }

    expect(await service.jobs.settle()).toEqual({ deadLetters: [] })
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1000)
  })
})
