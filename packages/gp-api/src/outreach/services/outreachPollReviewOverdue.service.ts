import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { subBusinessDays } from 'date-fns'
import { CronLockService } from '@/cron/services/cronLock.service'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { EASTERN_TIMEZONE } from '@/shared/util/date.util'
import { OutreachStatus, OutreachType } from '../../generated/prisma'

const POLL_REVIEW_OVERDUE_CRON = '33 * * * *'
const POLL_REVIEW_OVERDUE_JOB = 'pollReviewOverdue'
export const POLL_REVIEW_SLA_BUSINESS_DAYS = 2

// The `serve-poll-review-overdue` alert (deploy/components/alerts.ts) counts this
// exact line. Change both together.
export const POLL_REVIEW_OVERDUE_LOG =
  'Poll awaiting review past its business-day SLA'

/**
 * Logs one line per paid poll still awaiting staff review after two business
 * days, once an hour, for the Grafana alert to count. Read-only.
 */
@Injectable()
export class OutreachPollReviewOverdueService extends createPrismaBase(
  MODELS.Outreach,
) {
  constructor(private readonly cronLock: CronLockService) {
    super()
  }

  @Cron(POLL_REVIEW_OVERDUE_CRON, {
    name: POLL_REVIEW_OVERDUE_JOB,
    timeZone: EASTERN_TIMEZONE,
  })
  async logOverduePolls(): Promise<void> {
    const now = new Date()
    if (!(await this.cronLock.tryClaimHourlyRun(POLL_REVIEW_OVERDUE_JOB, now)))
      return

    try {
      // No column records when payment moved a poll to `pending`; the row is
      // created at checkout, so `createdAt` is the earliest it could have
      // entered review and never makes a poll look newer than it is.
      const overdue = await this.model.findMany({
        where: {
          outreachType: OutreachType.poll,
          status: OutreachStatus.pending,
          approvedAt: null,
          deniedAt: null,
          createdAt: {
            lt: subBusinessDays(now, POLL_REVIEW_SLA_BUSINESS_DAYS),
          },
        },
        select: { id: true, organizationSlug: true, createdAt: true },
      })
      for (const poll of overdue) {
        this.logger.warn(
          {
            outreachId: poll.id,
            organizationSlug: poll.organizationSlug,
            createdAt: poll.createdAt,
          },
          POLL_REVIEW_OVERDUE_LOG,
        )
      }
    } finally {
      await this.cronLock.markHourlyCompleted(POLL_REVIEW_OVERDUE_JOB, now)
    }
  }
}
