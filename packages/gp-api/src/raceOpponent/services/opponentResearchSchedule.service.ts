import { Injectable } from '@nestjs/common'
import { subMinutes } from 'date-fns'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import {
  ExperimentRunStatus,
  Prisma,
  RaceOpponentFindingKind,
  RaceOpponentResearchStatus,
} from '@/generated/prisma'
import { CampaignWith } from '@/campaigns/campaigns.types'
import { JobsService } from '@/jobs/jobs.service'
import type { JobRun } from '@/jobs/jobs.registry'
import { OpponentResearchService } from './opponentResearch.service'
import { OPPONENT_RESEARCH } from '../raceOpponent.constants'

// Per-tick cap on how many opponent rows the schedule re-dispatches in one run,
// keeping the fan-out (and paid Fargate runs) bounded per day.
const REDISPATCH_CAP_PER_TICK = 200

// A user start() claims a row and then inserts its run, so a claim with no
// run that has stood this long is not one a start() is still binding.
const STRANDED_CLAIM_MINUTES = 1

const SETTLED = [
  RaceOpponentResearchStatus.completed,
  RaceOpponentResearchStatus.failed,
]

const isAutomationEnabled = () =>
  process.env.MEETINGS_AUTOMATION_ENABLED === 'true'

@Injectable()
export class OpponentResearchScheduleService extends createPrismaBase(
  MODELS.RaceOpponentResearch,
) {
  constructor(
    private readonly opponentResearch: OpponentResearchService,
    private readonly jobs: JobsService,
  ) {
    super()
  }

  // The opponentResearchRefreshDaily schedule's worker: the daily refresh of
  // the opponent activity stream. Sends one opponentResearchRedispatch job per
  // row whose pass already settled (completed/failed), so the "what's new"
  // feed picks up findings that surfaced since the last run. The dispatch
  // path is reused from OpponentResearchService (claim-then-dispatch), and
  // replace-on-persist keyed by runId means an overlapping finding set
  // supersedes the row's findings without duplicating.
  async fanOutRefresh(): Promise<void> {
    if (!isAutomationEnabled()) {
      this.logger.info(
        'automation disabled; skipping opponent_research refresh cron',
      )
      return
    }

    const rows = await this.model.findMany({
      where: {
        kind: RaceOpponentFindingKind.opponent,
        status: { in: SETTLED },
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
      select: { id: true },
    })

    const day = new Date().toISOString().slice(0, 10)
    await this.jobs.sendMany(
      'opponentResearchRedispatch',
      rows.map(({ id }) => ({
        data: { researchId: id },
        key: `${id}:${day}`,
      })),
    )
  }

  // The opponentResearchRedispatch job's worker. Re-reads the row, since a
  // user may have started a pass since the fan-out picked it.
  async redispatch(job: JobRun<{ researchId: number }>): Promise<void> {
    // An earlier attempt claimed the row, failed to dispatch, and failed to
    // roll the claim back too. The row sits queued with no run: the read
    // below skips it, no fan-out selects it, and a user start() sees it as
    // in flight. Give the claim back, once nothing can be binding a run to it.
    if (job.retryCount > 0) {
      const stranded = await this.model.findFirst({
        where: {
          id: job.data.researchId,
          status: RaceOpponentResearchStatus.queued,
          runId: null,
        },
        select: {
          updatedAt: true,
          campaign: { select: { organizationSlug: true } },
        },
      })
      if (
        stranded &&
        !(await this.hasInFlightRun(stranded.campaign.organizationSlug))
      ) {
        if (
          stranded.updatedAt > subMinutes(new Date(), STRANDED_CLAIM_MINUTES)
        ) {
          throw new Error(
            `Opponent research row ${job.data.researchId} is claimed with ` +
              'no run yet; retrying once the claim has stood long enough',
          )
        }
        await this.model.updateMany({
          where: {
            id: job.data.researchId,
            status: RaceOpponentResearchStatus.queued,
            runId: null,
            updatedAt: stranded.updatedAt,
          },
          data: {
            status: RaceOpponentResearchStatus.failed,
            attempts: { decrement: 1 },
          },
        })
      }
    }

    const row = await this.model.findFirst({
      where: {
        id: job.data.researchId,
        kind: RaceOpponentFindingKind.opponent,
        status: { in: SETTLED },
        campaign: { isPro: true },
      },
      include: { campaign: { include: { user: true } } },
    })
    if (!row) return
    const campaign: CampaignWith<'user'> = row.campaign

    // Mirror assertAccess: a missing user can't pass the user-path gate
    // either, so skip the row rather than dispatching a paid run for it.
    if (!campaign.user) return

    if (await this.hasInFlightRun(campaign.organizationSlug)) return

    await this.opponentResearch.redispatchForRow(campaign, row)
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
