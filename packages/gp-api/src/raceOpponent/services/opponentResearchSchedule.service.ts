import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import {
  ExperimentRunStatus,
  Prisma,
  RaceOpponentFindingKind,
  RaceOpponentResearchStatus,
} from '@/generated/prisma'
import { CampaignWith } from '@/campaigns/campaigns.types'
import { CronLockService } from '@/cron/services/cronLock.service'
import { OpponentResearchService } from './opponentResearch.service'
import { OPPONENT_RESEARCH } from '../raceOpponent.constants'

const CRON_JOB = 'opponent_research_refresh'

// Per-tick cap on how many opponent rows the schedule re-dispatches in one run,
// keeping SQS fan-out (and paid Fargate runs) bounded per day.
const REDISPATCH_CAP_PER_TICK = 200

const isAutomationEnabled = () =>
  process.env.MEETINGS_AUTOMATION_ENABLED === 'true'

@Injectable()
export class OpponentResearchScheduleService extends createPrismaBase(
  MODELS.RaceOpponentResearch,
) {
  constructor(
    private readonly opponentResearch: OpponentResearchService,
    private readonly cronLock: CronLockService,
  ) {
    super()
  }

  // Daily refresh of the opponent activity stream: re-dispatch
  // opponent_research for rows whose pass already settled (completed/failed) so
  // the "what's new" feed picks up findings that surfaced since the last run.
  // CronLock collapses concurrent ECS replicas to one claim per UTC day; the
  // dispatch path is reused from OpponentResearchService (claim-then-dispatch),
  // and replace-on-persist keyed by runId means an overlapping finding set
  // supersedes the row's findings without duplicating.
  @Cron('0 7 * * *')
  async refreshOpponentResearch(): Promise<void> {
    if (!isAutomationEnabled()) {
      this.logger.info(
        'automation disabled; skipping opponent_research refresh cron',
      )
      return
    }

    const now = new Date()
    const claimed = await this.cronLock.tryClaimDailyRun(CRON_JOB, now)
    if (!claimed) return

    try {
      await this.redispatchSettledRows()
    } finally {
      await this.cronLock.markCompleted(CRON_JOB, now)
    }
  }

  private async redispatchSettledRows(): Promise<void> {
    const rows = await this.model.findMany({
      where: {
        kind: RaceOpponentFindingKind.opponent,
        status: {
          in: [
            RaceOpponentResearchStatus.completed,
            RaceOpponentResearchStatus.failed,
          ],
        },
        // The schedule bypasses assertAccess (no request context), so the Pro
        // gate the user path enforces must live in the query: a campaign whose
        // Pro lapsed after its rows were created must not get a paid re-dispatch.
        campaign: { isPro: true },
      },
      // One row per campaign per tick so a single org with many settled rows
      // can't consume the whole budget and starve other orgs. distinct keeps
      // the first row per campaignId in orderBy order, so campaignId leads the
      // sort (required for distinct to be deterministic) and updatedAt asc picks
      // the stalest row for that campaign.
      distinct: ['campaignId'],
      orderBy: [
        { campaignId: Prisma.SortOrder.asc },
        { updatedAt: Prisma.SortOrder.asc },
      ],
      take: REDISPATCH_CAP_PER_TICK,
      include: { campaign: { include: { user: true } } },
    })

    for (const row of rows) {
      const campaign: CampaignWith<'user'> = row.campaign

      // Mirror assertAccess: a missing user can't pass the user-path gate
      // either, so skip the row rather than dispatching a paid run for it.
      if (!campaign.user) continue

      if (await this.hasInFlightRun(campaign.organizationSlug)) continue

      await this.opponentResearch.redispatchForRow(campaign, row)
    }
  }

  // Skip an org with an in-flight opponent_research run so the schedule never
  // stacks a second paid run on top of one the user (or a prior tick) already
  // kicked off.
  private async hasInFlightRun(organizationSlug: string): Promise<boolean> {
    const inFlight = await this.client.experimentRun.findFirst({
      where: {
        organizationSlug,
        experimentType: OPPONENT_RESEARCH,
        status: {
          in: [
            ExperimentRunStatus.QUEUED,
            ExperimentRunStatus.RUNNING,
            ExperimentRunStatus.AWAITING_RESUME,
            ExperimentRunStatus.SUPERSEDED,
          ],
        },
      },
      select: { runId: true },
    })
    return inFlight !== null
  }
}
