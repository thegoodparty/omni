import { Injectable } from '@nestjs/common'
import { planEndsAt } from '@goodparty_org/contracts'
import { isBefore } from 'date-fns'
import { AnalyticsService } from '@/analytics/analytics.service'
import { FeaturesService } from '@/features/services/features.service'
import { PlanPricingModel } from '@/generated/prisma'
import type { JobRun, ScheduleData } from '@/jobs/jobs.registry'
import { JobsService } from '@/jobs/jobs.service'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { WIN_PLAN_EXPIRY_SWEEP_FLAG } from '@/shared/util/winPlanExpirySweepFlag.util'
import { EVENTS } from '@/vendors/segment/segment.types'
import { CampaignsService } from '../services/campaigns.service'
import { LockedCampaignState } from './planState.util'

// Thrown inside setIsPro's transaction to roll it back when the row, read
// again under its lock, is no longer due: an admin extended the plan or it
// ended between the select and the lock.
class NotDueError extends Error {}

type EndsAtInput = {
  planEndsAtOverride: Date | null
  electionDate: string | null
}

type PlanCandidate = EndsAtInput & { id: number; userId: number }

const electionDateOf = (details: LockedCampaignState['details']) =>
  typeof details === 'object' &&
  details !== null &&
  !Array.isArray(details) &&
  typeof details.electionDate === 'string'
    ? details.electionDate
    : null

const endsAtOf = ({ planEndsAtOverride, electionDate }: EndsAtInput) =>
  planEndsAt({ planEndsAtOverride, details: { electionDate } })

const isDue = (input: EndsAtInput, now: Date) => {
  const endsAt = endsAtOf(input)
  return endsAt !== null && isBefore(endsAt, now)
}

@Injectable()
export class PlanExpiryService extends createPrismaBase(MODELS.Campaign) {
  constructor(
    private readonly campaigns: CampaignsService,
    private readonly jobs: JobsService,
    private readonly features: FeaturesService,
    private readonly analytics: AnalyticsService,
  ) {
    super()
  }

  // The select narrows to active one-time plans, which are the paid Win
  // campaigns and nothing larger; planEndsAt() then decides which are due, so
  // the date rule lives in one place and a malformed election date cannot
  // fail the whole query.
  async fanOut(_job: JobRun<ScheduleData>): Promise<void> {
    const rows = await this.client.$queryRaw<
      {
        id: number
        user_id: number
        plan_ends_at_override: Date | null
        election_date: string | null
      }[]
    >`
      SELECT id, user_id, plan_ends_at_override,
        details->>'electionDate' AS election_date
      FROM campaign
      WHERE is_pro
        AND plan_pricing_model = 'one_time'
        AND plan_ended_at IS NULL
      ORDER BY id`
    const candidates: PlanCandidate[] = rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      planEndsAtOverride: row.plan_ends_at_override,
      electionDate: row.election_date,
    }))

    const now = new Date()
    const undated = candidates.filter(
      (candidate) => endsAtOf(candidate) === null,
    )
    this.logger.info(
      { count: undated.length },
      'Active one-time plans with no election date and no override',
    )

    const due = candidates.filter((candidate) => isDue(candidate, now))
    const toEnd: number[] = []
    for (const candidate of due) {
      const enabled = await this.features.isFeatureEnabled({
        user: candidate.userId,
        feature: WIN_PLAN_EXPIRY_SWEEP_FLAG,
      })
      if (enabled) {
        toEnd.push(candidate.id)
      } else {
        this.logger.info(
          { campaignId: candidate.id },
          'Plan expiry sweep is off; would end this plan',
        )
      }
    }

    await this.jobs.sendMany(
      'planExpire',
      toEnd.map((campaignId) => ({
        data: { campaignId },
        key: `${campaignId}:${now.toISOString().slice(0, 10)}`,
      })),
    )
  }

  async expire(job: JobRun<{ campaignId: number }>): Promise<void> {
    const { campaignId } = job.data
    const now = new Date()

    // Cheap early exit; the decision is made again under the row lock below.
    const campaign = await this.client.campaign.findUnique({
      where: { id: campaignId },
      select: {
        userId: true,
        isPro: true,
        planPricingModel: true,
        planEndedAt: true,
        planEndsAtOverride: true,
        details: true,
      },
    })
    if (!campaign || !this.isEndable(campaign, now)) {
      this.logger.info({ campaignId }, 'Plan not due; left as is')
      return
    }

    try {
      await this.campaigns.setIsPro(campaignId, false, true, async (locked) => {
        if (!this.isEndable(locked, now)) throw new NotDueError()
        // Sent from the locked row, before the commit, so an admin extend
        // that landed after the read above means no event, and a Segment
        // failure throws, rolls the write back and fails the job while the
        // plan is still due. After a commit a retry would return at the
        // check above and nothing could resend it. The messageId dedups a
        // retry that sent it already. The cost is one Segment call while
        // this campaign row is locked, which only blocks other writers to
        // that row.
        await this.analytics.track(
          campaign.userId,
          EVENTS.Account.PaidPlanUpdated,
          {
            plan: locked.plan,
            change: 'ended',
            reason: 'election_passed',
            creditExpiredCents: locked.outreachCreditCents,
          },
          undefined,
          `plan-ended:${campaignId}`,
        )
        return { planEndedAt: now, outreachCreditCents: 0 }
      })
    } catch (error) {
      if (error instanceof NotDueError) {
        this.logger.info({ campaignId }, 'Plan extended under the lock')
        return
      }
      throw error
    }
    this.logger.info({ campaignId }, 'Plan ended')
  }

  private isEndable(
    campaign: Pick<
      LockedCampaignState,
      | 'isPro'
      | 'planPricingModel'
      | 'planEndedAt'
      | 'planEndsAtOverride'
      | 'details'
    >,
    now: Date,
  ) {
    return (
      campaign.isPro &&
      campaign.planPricingModel === PlanPricingModel.one_time &&
      !campaign.planEndedAt &&
      isDue(
        {
          planEndsAtOverride: campaign.planEndsAtOverride,
          electionDate: electionDateOf(campaign.details),
        },
        now,
      )
    )
  }
}
