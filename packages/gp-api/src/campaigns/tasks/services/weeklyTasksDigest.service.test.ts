import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { firstOrThrow } from 'src/shared/test-utils/arrays.util'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { JobsService } from '@/jobs/jobs.service'
import { WeeklyTasksDigestHandlerService } from './weeklyTasksDigestHandler.service'
import { WeeklyTasksDigestService } from './weeklyTasksDigest.service'

describe('WeeklyTasksDigestService', () => {
  let service: WeeklyTasksDigestService
  let sendMany: ReturnType<typeof vi.fn>

  beforeEach(() => {
    sendMany = vi.fn().mockResolvedValue([])
    const handler = {
      findEligibleCampaignIds: vi.fn().mockResolvedValue([7]),
    } as unknown as WeeklyTasksDigestHandlerService
    const jobs = { sendMany } as unknown as JobsService

    service = new WeeklyTasksDigestService(handler, jobs, createMockLogger())
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const sentItem = () => {
    const [name, items] = firstOrThrow(sendMany.mock.calls)
    expect(name).toBe('weeklyTasksDigestCampaign')
    return firstOrThrow(items as Array<{ data: object; key: string }>)
  }

  describe('window calculation', () => {
    it('sends a window covering Monday Apr 20 through Sunday Apr 26 when today is Sunday Apr 19 Central', async () => {
      // Sunday April 19, 2026 at 11:00 PM Central Daylight Time = 04:00 UTC Monday April 20
      vi.setSystemTime(new Date('2026-04-20T04:00:00.000Z'))

      await service.fanOut()

      expect(sendMany).toHaveBeenCalledOnce()
      expect(sentItem()).toEqual({
        data: {
          campaignId: 7,
          windowStart: '2026-04-20T00:00:00.000Z',
          windowEnd: '2026-04-27T00:00:00.000Z',
        },
        key: '7:2026-04-20T00:00:00.000Z',
      })
    })

    it('still targets the same Monday when the schedule runs later Sunday night (11:59 PM Central)', async () => {
      // Sunday April 19, 2026 at 11:59 PM CDT = 04:59 UTC Monday April 20
      vi.setSystemTime(new Date('2026-04-20T04:59:00.000Z'))

      await service.fanOut()

      expect(sentItem().data).toMatchObject({
        windowStart: '2026-04-20T00:00:00.000Z',
        windowEnd: '2026-04-27T00:00:00.000Z',
      })
    })

    it('uses the upcoming Monday when run on Saturday night Central', async () => {
      // Saturday April 18, 2026 at 11:00 PM CDT = 04:00 UTC Sunday April 19
      vi.setSystemTime(new Date('2026-04-19T04:00:00.000Z'))

      await service.fanOut()

      expect(sentItem().data).toMatchObject({
        windowStart: '2026-04-20T00:00:00.000Z',
        windowEnd: '2026-04-27T00:00:00.000Z',
      })
    })

    it('handles standard time (non-DST) correctly', async () => {
      // Sunday January 4, 2026 at 11:00 PM CST = 05:00 UTC Monday January 5
      vi.setSystemTime(new Date('2026-01-05T05:00:00.000Z'))

      await service.fanOut()

      expect(sentItem().data).toMatchObject({
        windowStart: '2026-01-05T00:00:00.000Z',
        windowEnd: '2026-01-12T00:00:00.000Z',
      })
    })
  })
})
