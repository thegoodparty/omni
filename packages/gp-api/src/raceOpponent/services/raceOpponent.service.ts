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
  // the remaining gates; both 4xx so the webapp can branch cleanly. Public so
  // the controller can apply the same Pro+flag gate to opponent routes that
  // don't go through collect() (e.g. opponents/identify).
  async assertAccess(campaign: CampaignWith<'user'>): Promise<void> {
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
      // Frontend-driven two-call: discovery is running. The page polls GET
      // (which reports 'discovering' off the in-flight run) and re-fires collect
      // once opponents persist — at which point the opponents-present branch
      // above dispatches collection. No server-side flag to strand.
      return { runId: discovery.oppositionRunId, status: 'discovering' }
    }

    // 'unavailable' — no race, election-api down, attempt cap reached, or SQS
    // send failed. Logged inside ensureOppositionResearch; surface a calm idle
    // rather than a 500 so the page shows its empty state.
    return { runId: null, status: 'idle' }
  }

  // The in-flight dedup + race_opponent_collection dispatch. Reached from
  // collect() once opponent names exist (from the plan, or from a discovery run
  // the page re-fired collect after). The dedup is unchanged from the original.
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

  async get(campaign: CampaignWith<'user'>): Promise<RaceOpponentResponse> {
    await this.assertAccess(campaign)

    const rows = await this.model.findMany({
      where: { campaignId: campaign.id },
      orderBy: { createdAt: Prisma.SortOrder.asc },
    })

    return {
      opponents: this.groupByOpponent(rows, await this.loadRoster(campaign.id)),
      lastCollectedAt: this.lastCollectedAt(rows),
      collectionStatus: await this.collectionStatus(
        campaign.id,
        campaign.organizationSlug,
      ),
    }
  }

  // The campaign-strategy opponent roster (already populated by the plan;
  // CampaignStrategyOpponent carries party + incumbency). Read here only to
  // enrich the grouped response — no new external call, this is the same
  // relation collect() reads via loadOpposition. Keyed by normalized name so
  // groupByOpponent can resolve party/incumbency per collected opponent.
  private async loadRoster(
    campaignId: number,
  ): Promise<
    Map<string, { party: string | null; isIncumbent: boolean | null }>
  > {
    const plan = await this.client.campaignStrategy.findUnique({
      where: { campaignId },
      include: { opponents: true },
    })
    const byName = new Map<
      string,
      { party: string | null; isIncumbent: boolean | null }
    >()
    for (const opponent of plan?.opponents ?? []) {
      byName.set(opponent.fullName.trim().toLowerCase(), {
        party: opponent.partyAffiliation,
        isIncumbent: opponent.incumbent ?? null,
      })
    }
    return byName
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
    roster: Map<string, { party: string | null; isIncumbent: boolean | null }>,
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
    return [...byName.entries()].map(([opponentName, items]) => {
      // Conservative name match against the roster: trim + lowercase only
      // (mirrors opponentResearch.matchRosterCandidate). No match => both null
      // rather than mis-attributing a party badge.
      const match = roster.get(opponentName.trim().toLowerCase())
      return {
        opponentName,
        party: match?.party ?? null,
        isIncumbent: match?.isIncumbent ?? null,
        items,
      }
    })
  }

  private lastCollectedAt(rows: RaceOpponentRow[]): Date | null {
    if (rows.length === 0) return null
    return rows.reduce(
      (latest, row) => (row.createdAt > latest ? row.createdAt : latest),
      rows[0].createdAt,
    )
  }

  // Derived purely from run state — there's no status column, the run table is
  // the source of truth, so nothing can strand. The latest race_opponent_collection
  // run wins. Before any collection run exists, the campaign's own discovery run
  // (plan.oppositionRunId — scoped to THIS plan, never an org-wide/stale run)
  // drives the status: in-flight -> 'discovering', FAILED -> 'failed', else
  // 'idle'. A FAILED discovery MUST read as 'failed' (not 'idle'): the page
  // auto-fires collect on a discovering->idle transition, and a FAILED run is
  // re-dispatchable, so reporting 'idle' would loop the page into re-dispatching
  // discovery until the attempt cap. 'failed' stops the auto-fire and lets the
  // user retry manually.
  private async collectionStatus(
    campaignId: number,
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
    if (run) {
      switch (run.status) {
        case ExperimentRunStatus.COMPLETED:
          return 'completed'
        case ExperimentRunStatus.FAILED:
          return 'failed'
        default:
          return 'running'
      }
    }

    const plan = await this.client.campaignStrategy.findUnique({
      where: { campaignId },
      select: { oppositionRunId: true },
    })
    if (!plan?.oppositionRunId) return 'idle'

    const discovery = await this.client.experimentRun.findUnique({
      where: { runId: plan.oppositionRunId },
      select: { status: true },
    })
    if (!discovery) return 'idle'
    if (discovery.status === ExperimentRunStatus.FAILED) return 'failed'
    const inFlight =
      discovery.status === ExperimentRunStatus.QUEUED ||
      discovery.status === ExperimentRunStatus.RUNNING ||
      discovery.status === ExperimentRunStatus.AWAITING_RESUME
    return inFlight ? 'discovering' : 'idle'
  }
}
