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
import { CampaignStrategyService } from '@/campaignStrategy/services/campaignStrategy.service'
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
    private readonly campaignStrategy: CampaignStrategyService,
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

    const { opponents, oppositionPersistedAt } = await this.loadOpposition(
      campaign.id,
    )

    // Plan already identified opponents (the campaign plan ran, or a prior
    // discovery landed names) — collect them now, exactly as before.
    if (opponents.length > 0) {
      return this.dispatchCollection(campaign, clerkUserId, opponents)
    }

    // No names, but discovery already ran and found none: a genuinely
    // uncontested race. Settle to idle rather than re-dispatching discovery on
    // every poll/click. Keyed on the persist marker, NOT "opponents is empty"
    // alone, so a never-discovered race still triggers discovery below.
    if (oppositionPersistedAt) {
      return { runId: null, status: 'idle' }
    }

    // No names and no discovery yet: discover opponents the same way the
    // campaign plan does (opposition_research), then auto-chain collection when
    // it completes (RaceOpponentPersistService). Discovery lives only in that
    // experiment so the two paths can't drift.
    const discovery =
      await this.campaignStrategy.ensureOppositionResearch(campaign)

    if (discovery.disposition === 'persisted') {
      // Discovery completed between our read and the dispatch attempt — collect
      // with whatever just landed (empty => still uncontested).
      const discovered = await this.buildOpponents(campaign.id)
      return discovered.length > 0
        ? this.dispatchCollection(campaign, clerkUserId, discovered)
        : { runId: null, status: 'idle' }
    }

    if (discovery.disposition === 'inflight') {
      await this.markCollectionPending(campaign.id)
      return { runId: discovery.oppositionRunId, status: 'discovering' }
    }

    // 'unavailable' — no race, election-api down, attempt cap reached, or SQS
    // send failed. Logged inside ensureOppositionResearch; surface a calm idle
    // rather than a 500 so the page shows its empty state.
    return { runId: null, status: 'idle' }
  }

  // Shared collection-dispatch path: the in-flight dedup + race_opponent_collection
  // dispatch, reused by collect() (plan opponents present) and the auto-chain
  // after discovery. The dedup is unchanged from the original collect().
  private async dispatchCollection(
    campaign: CampaignWith<'user'>,
    clerkUserId: string,
    opponents: { full_name: string }[],
  ): Promise<RaceOpponentCollectResponse> {
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
        // The contract types opponents as a non-empty tuple; the caller only
        // passes non-empty arrays, but the type can't prove it.
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

  // Auto-chain entry point, called from RaceOpponentPersistService when an
  // opposition_research run completes (the plan's hook has already persisted
  // the opponents upstream in the queue consumer). If collect() left a
  // collection pending, dispatch it now with the freshly-persisted names, then
  // clear the flag. The flag is the idempotency guard: a duplicate completion
  // delivery finds it cleared and no-ops. Zero opponents (uncontested race)
  // clears the flag WITHOUT dispatching, so the next poll settles to idle
  // instead of re-discovering.
  async chainCollectionAfterDiscovery(campaignId: number): Promise<void> {
    const plan = await this.client.campaignStrategy.findUnique({
      where: { campaignId },
      select: { raceOpponentCollectionPendingAt: true },
    })
    if (!plan?.raceOpponentCollectionPendingAt) return

    const opponents = await this.buildOpponents(campaignId)
    if (opponents.length === 0) {
      await this.clearCollectionPending(campaignId)
      return
    }

    const campaign = await this.client.campaign.findUnique({
      where: { id: campaignId },
      include: { user: true },
    })
    const clerkUserId = campaign?.user?.clerkId
    if (!campaign || !clerkUserId) {
      this.logger.warn(
        { campaignId },
        'opponents discovered but campaign/user unavailable; clearing pending',
      )
      await this.clearCollectionPending(campaignId)
      return
    }

    // Clear the flag BEFORE dispatching. If we cleared after and the clear
    // threw, the requeued message would be dropped on redelivery (the
    // opposition_research run is already terminal COMPLETED), stranding the flag
    // set forever while a live collection run exists. dispatchCollection's
    // in-flight dedup makes clearing first safe against a double delivery, and a
    // dispatch failure after the clear leaves a clean state the next collect()
    // retries from.
    await this.clearCollectionPending(campaignId)
    await this.dispatchCollection(campaign, clerkUserId, opponents)
  }

  private async markCollectionPending(campaignId: number): Promise<void> {
    await this.client.campaignStrategy.update({
      where: { campaignId },
      data: { raceOpponentCollectionPendingAt: new Date() },
    })
  }

  private async clearCollectionPending(campaignId: number): Promise<void> {
    await this.client.campaignStrategy.update({
      where: { campaignId },
      data: { raceOpponentCollectionPendingAt: null },
    })
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
      collectionStatus: await this.collectionStatus(
        campaign.id,
        campaign.organizationSlug,
      ),
    }
  }

  private async buildOpponents(
    campaignId: number,
  ): Promise<{ full_name: string }[]> {
    return (await this.loadOpposition(campaignId)).opponents
  }

  // The plan's opponent names plus its opposition persist marker, read in one
  // query. collect() needs both: the marker distinguishes "never discovered"
  // (trigger discovery) from "discovered, uncontested" (settle to idle).
  private async loadOpposition(campaignId: number): Promise<{
    opponents: { full_name: string }[]
    oppositionPersistedAt: Date | null
  }> {
    const plan = await this.client.campaignStrategy.findUnique({
      where: { campaignId },
      include: { opponents: true },
    })
    return {
      opponents: (plan?.opponents ?? []).map((o) => ({
        full_name: o.fullName,
      })),
      oppositionPersistedAt: plan?.oppositionPersistedAt ?? null,
    }
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
  //
  // A pending discovery (collect() dispatched opposition_research and is waiting
  // to auto-chain collection) has no race_opponent_collection run yet, so it
  // reads as 'discovering' off the plan flag. Once collection is dispatched the
  // flag is cleared and the run table below takes over (running -> completed).
  private async collectionStatus(
    campaignId: number,
    organizationSlug: string,
  ): Promise<RaceOpponentCollectionStatus> {
    const plan = await this.client.campaignStrategy.findUnique({
      where: { campaignId },
      select: { raceOpponentCollectionPendingAt: true },
    })
    if (plan?.raceOpponentCollectionPendingAt) return 'discovering'

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
