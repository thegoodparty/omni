import { Injectable } from '@nestjs/common'
import { addDays } from 'date-fns'
import { PinoLogger } from 'nestjs-pino'
import { JobsService } from '@/jobs/jobs.service'
import {
  CENTRAL_TIMEZONE,
  nextMondayUtcMidnight,
} from 'src/shared/util/date.util'
import { WeeklyTasksDigestHandlerService } from './weeklyTasksDigestHandler.service'

@Injectable()
export class WeeklyTasksDigestService {
  constructor(
    private readonly digestHandler: WeeklyTasksDigestHandlerService,
    private readonly jobs: JobsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(WeeklyTasksDigestService.name)
  }

  // The weeklyTasksDigest schedule's worker (src/jobs/jobs.registry.ts).
  // Sends one weeklyTasksDigestCampaign job per eligible campaign; the key
  // pins each job to its campaign and week, so a second run that week sends
  // nothing new while the first run's jobs are still queued.
  async fanOut(): Promise<void> {
    const windowStart = nextMondayUtcMidnight(new Date(), CENTRAL_TIMEZONE)
    const windowEnd = addDays(windowStart, 7)
    const campaignIds = await this.digestHandler.findEligibleCampaignIds(
      windowStart,
      windowEnd,
    )
    await this.jobs.sendMany(
      'weeklyTasksDigestCampaign',
      campaignIds.map((campaignId) => ({
        data: {
          campaignId,
          windowStart: windowStart.toISOString(),
          windowEnd: windowEnd.toISOString(),
        },
        key: `${campaignId}:${windowStart.toISOString()}`,
      })),
    )
    this.logger.info(
      { windowStart, windowEnd, campaigns: campaignIds.length },
      'Weekly tasks digest fanned out',
    )
  }
}
