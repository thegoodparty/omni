import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common'
import { z } from 'zod'
import {
  RaceOpponent,
  RaceOpponentCollectionStatus,
  RaceOpponentResponse,
} from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import {
  ExperimentRunStatus,
  Prisma,
  RaceOpponent as RaceOpponentRow,
} from '@/generated/prisma'
import { CampaignWith } from '@/campaigns/campaigns.types'
import { FeaturesService } from '@/features/services/features.service'
import { ExperimentRunsService } from '@/agentExperiments/services/experimentRuns.service'
import { AgentJobContracts } from '@/generated/agent-job-contracts'
import { ElectionApiService } from '@/campaignStrategy/services/electionApi.service'
import {
  KNOW_YOUR_OPPONENT_FEATURE,
  RACE_OPPONENT_COLLECTION,
} from '../raceOpponent.constants'
import { RaceOpponentCollectResponse } from '../schemas/raceOpponentCollect.schema'

type CollectionInput = AgentJobContracts['race_opponent_collection']['Input']

// Only the campaign-details keys this module reads; the column is untyped JSON
// at runtime, so each leaf is independently fault-tolerant.
const lenientString = z.string().nullable().optional().catch(null)
const CampaignDetailsSchema = z
  .object({ raceId: lenientString, city: lenientString })
  .partial()

@Injectable()
export class RaceOpponentService extends createPrismaBase(MODELS.RaceOpponent) {
  constructor(
    private readonly features: FeaturesService,
    private readonly experimentRuns: ExperimentRunsService,
    private readonly electionApi: ElectionApiService,
  ) {
    super()
  }

  // The ownership guard (@UseCampaign) already scopes the campaign to the
  // current user, so reaching here means the caller owns it. Pro + flag are
  // the remaining gates; both 4xx so the webapp can branch cleanly.
  private async assertAccess(campaign: CampaignWith<'user'>): Promise<void> {
    if (!campaign.isPro) {
      throw new ForbiddenException('Race opponent collection requires Pro.')
    }
    if (!campaign.user) {
      throw new BadRequestException(
        'Campaign has no associated user — check @UseCampaign include.',
      )
    }
    const enabled = await this.features.isFeatureEnabled({
      user: campaign.user,
      feature: KNOW_YOUR_OPPONENT_FEATURE,
    })
    if (!enabled) {
      throw new ForbiddenException('know-your-opponent is not enabled.')
    }
  }

  async collect(
    campaign: CampaignWith<'user'>,
  ): Promise<RaceOpponentCollectResponse> {
    await this.assertAccess(campaign)

    const clerkUserId = campaign.user?.clerkId
    if (!clerkUserId) {
      throw new BadRequestException(
        'User must be signed in to collect opponent data.',
      )
    }

    const opponents = await this.buildOpponents(campaign.id)
    if (opponents.length === 0) {
      throw new BadRequestException(
        'No opponents found — generate the campaign plan first.',
      )
    }

    // Reuse an already-in-flight run instead of dispatching a duplicate: a
    // double-click or client retry would otherwise spawn a second paid Fargate
    // run whose persist would later wipe the first's rows on completion. Mirrors
    // CampaignStrategyService.sectionState (QUEUED/RUNNING/AWAITING_RESUME =
    // in flight). Not a hard claim — a tight concurrent race can still slip a
    // second through — but it closes the common retry/double-submit case.
    const inFlight = await this.client.experimentRun.findFirst({
      where: {
        organizationSlug: campaign.organizationSlug,
        experimentType: RACE_OPPONENT_COLLECTION,
        status: {
          in: [
            ExperimentRunStatus.QUEUED,
            ExperimentRunStatus.RUNNING,
            ExperimentRunStatus.AWAITING_RESUME,
          ],
        },
      },
      orderBy: { createdAt: Prisma.SortOrder.desc },
      select: { runId: true },
    })
    if (inFlight) {
      return { runId: inFlight.runId, status: 'running' }
    }

    const run = await this.experimentRuns.dispatchRun({
      type: RACE_OPPONENT_COLLECTION,
      organizationSlug: campaign.organizationSlug,
      clerkUserId,
      params: {
        // The contract types opponents as a non-empty tuple; the length guard
        // above makes that true at runtime, but the type can't prove it.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        opponents: opponents as CollectionInput['opponents'],
        race_context: await this.buildRaceContext(campaign),
      },
    })
    if (!run) {
      throw new BadRequestException(
        'Opponent collection is not available in this environment.',
      )
    }

    return { runId: run.runId, status: 'running' }
  }

  async get(campaign: CampaignWith<'user'>): Promise<RaceOpponentResponse> {
    await this.assertAccess(campaign)

    const rows = await this.model.findMany({
      where: { campaignId: campaign.id },
      orderBy: { createdAt: Prisma.SortOrder.asc },
    })

    return {
      opponents: this.groupByOpponent(rows),
      lastCollectedAt: this.lastCollectedAt(rows),
      collectionStatus: await this.collectionStatus(campaign.organizationSlug),
    }
  }

  private async buildOpponents(
    campaignId: number,
  ): Promise<{ full_name: string }[]> {
    const plan = await this.client.campaignStrategy.findUnique({
      where: { campaignId },
      include: { opponents: true },
    })
    return (plan?.opponents ?? []).map((o) => ({ full_name: o.fullName }))
  }

  // race_context is a discovery hint only (state/city/office/cycle). A missing
  // race row or an election-api outage degrades it to nulls rather than
  // blocking the run — the agent can still discover sources from names alone.
  private async buildRaceContext(
    campaign: CampaignWith<'user'>,
  ): Promise<CollectionInput['race_context']> {
    const details = CampaignDetailsSchema.safeParse(campaign.details)
    const city = details.success ? (details.data.city ?? null) : null
    const raceId = details.success ? (details.data.raceId ?? '').trim() : ''

    if (raceId.length === 0) {
      return { city, election_date: null, office_name: null, state: null }
    }

    try {
      const race = await this.electionApi.getRaceContext(raceId)
      return {
        city,
        election_date:
          race.generalElectionDate ?? race.relevantElectionDate ?? null,
        office_name: race.officialOfficeName ?? race.candidateOffice ?? null,
        state: race.state,
      }
    } catch {
      this.logger.warn(
        { campaignId: campaign.id, raceId },
        'race context unavailable; dispatching with name-only hints',
      )
      return { city, election_date: null, office_name: null, state: null }
    }
  }

  private groupByOpponent(
    rows: RaceOpponentRow[],
  ): RaceOpponentResponse['opponents'] {
    const byName = new Map<string, RaceOpponent[]>()
    for (const row of rows) {
      const items = byName.get(row.opponentName) ?? []
      items.push({
        id: row.id,
        opponentName: row.opponentName,
        sourceType: row.sourceType,
        sourceUrl: row.sourceUrl,
        content: row.content,
        collectedAt: row.createdAt,
      })
      byName.set(row.opponentName, items)
    }
    return [...byName.entries()].map(([opponentName, items]) => ({
      opponentName,
      items,
    }))
  }

  private lastCollectedAt(rows: RaceOpponentRow[]): Date | null {
    if (rows.length === 0) return null
    return rows.reduce(
      (latest, row) => (row.createdAt > latest ? row.createdAt : latest),
      rows[0].createdAt,
    )
  }

  // Derived from the latest collection run for this org — there's no status
  // column, the run table is the source of truth. No run -> idle.
  private async collectionStatus(
    organizationSlug: string,
  ): Promise<RaceOpponentCollectionStatus> {
    const run = await this.client.experimentRun.findFirst({
      where: {
        organizationSlug,
        experimentType: RACE_OPPONENT_COLLECTION,
      },
      orderBy: { createdAt: Prisma.SortOrder.desc },
      select: { status: true },
    })
    if (!run) return 'idle'
    switch (run.status) {
      case ExperimentRunStatus.COMPLETED:
        return 'completed'
      case ExperimentRunStatus.FAILED:
        return 'failed'
      default:
        return 'running'
    }
  }
}
