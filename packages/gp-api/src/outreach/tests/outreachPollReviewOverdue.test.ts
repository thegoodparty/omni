import { subDays } from 'date-fns'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OutreachStatus, OutreachType } from '@/generated/prisma'
import { useTestService } from '@/test-service'
import {
  OutreachPollReviewOverdueService,
  POLL_REVIEW_OVERDUE_LOG,
} from '../services/outreachPollReviewOverdue.service'

const service = useTestService({ jobs: true })

const ORG_SLUG = 'eo-poll-review-overdue'

const createPoll = (
  data: Partial<{
    status: OutreachStatus
    createdAt: Date
    approvedAt: Date
  }> = {},
) =>
  service.prisma.outreach.create({
    data: {
      campaignId: null,
      organizationSlug: ORG_SLUG,
      outreachType: OutreachType.poll,
      status: OutreachStatus.pending,
      ...data,
    },
  })

beforeEach(async () => {
  await service.prisma.organization.create({
    data: { slug: ORG_SLUG, ownerId: service.user.id },
  })
})

describe('the pollReviewOverdue schedule', () => {
  it('logs each paid poll still unreviewed past 2 business days', async () => {
    const warn = vi.spyOn(
      service.app.get(OutreachPollReviewOverdueService).logger,
      'warn',
    )
    const old = await createPoll({ createdAt: subDays(new Date(), 6) })
    await createPoll()
    await createPoll({
      createdAt: subDays(new Date(), 6),
      approvedAt: new Date(),
    })
    await createPoll({
      createdAt: subDays(new Date(), 6),
      status: OutreachStatus.pending_payment,
    })

    await service.jobs.runSchedule('pollReviewOverdue')

    const lines = warn.mock.calls.filter(
      ([, message]) => message === POLL_REVIEW_OVERDUE_LOG,
    )
    expect(lines).toHaveLength(1)
    expect(lines[0]?.[0]).toMatchObject({ outreachId: old.id })
  })
})
