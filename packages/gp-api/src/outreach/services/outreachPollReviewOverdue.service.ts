import { Injectable } from '@nestjs/common'
import { subBusinessDays } from 'date-fns'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { OutreachStatus, OutreachType } from '../../generated/prisma'

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
  // The pollReviewOverdue schedule's worker (src/jobs/jobs.registry.ts).
  async logOverduePolls(): Promise<void> {
    const now = new Date()
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
  }
}
