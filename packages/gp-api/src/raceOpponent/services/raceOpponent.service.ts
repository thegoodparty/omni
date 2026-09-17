import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common'
import { isAfter } from 'date-fns'
import { z } from 'zod'
import {
  RaceOpponent,
  RaceOpponentCollectionStatus,
  RaceOpponentFieldAnalysis,
  RaceOpponentFieldAnalysisSchema,
  RaceOpponentResponse,
  RaceOpponentStandoutAction,
  RaceOpponentStandoutActionSchema,
  RaceOpponentSummary,
  RaceOpponentSummarySchema,
  RaceOpponentThreatTier,
} from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import {
  ExperimentRunStatus,
  Prisma,
  RaceOpponent as RaceOpponentRow,
  RaceOpponentSourceType,
} from '@/generated/prisma'
import { CampaignWith } from '@/campaigns/campaigns.types'
import { ExperimentRunsService } from '@/agentExperiments/services/experimentRuns.service'
import { AgentJobContracts } from '@/generated/agent-job-contracts'
import { ElectionApiService } from '@/campaignStrategy/services/electionApi.service'
import { CampaignStrategyService } from '@/campaignStrategy/services/campaignStrategy.service'
import { DistrictResolverService } from '@/chats/briefing-chats/services/districtResolver.service'
import {
  RACE_OPPONENT_ACTIONS,
  RACE_OPPONENT_COLLECTION,
  RACE_OPPONENT_SUMMARY,
} from '../raceOpponent.constants'
import { RaceOpponentCollectResponse } from '../schemas/raceOpponentCollect.schema'
import { ManualOpponentsRequest } from '../schemas/manualOpponents.schema'

type CollectionInput = AgentJobContracts['race_opponent_collection']['Input']
type SummaryInput = AgentJobContracts['race_opponent_summary']['Input']
type ActionsInput = AgentJobContracts['race_opponent_actions']['Input']

// Producer-side bound on the summary section text forwarded to the actions
// dispatch — every dispatchRun caller with variable-length text bounds it
// (the fitPlatform precedent in opponentResearch.service.ts). Summary text is
// LLM-emitted and usually short; a per-field char cap is enough headroom.
const MAX_ACTIONS_TEXT_CHARS = 4000

// Only the campaign-details keys this module reads; the column is untyped JSON
// at runtime, so each leaf is independently fault-tolerant.
const lenientString = z.string().nullable().optional().catch(null)
const CampaignDetailsSchema = z
  .object({ raceId: lenientString, city: lenientString })
  .partial()

// The collected page text lives in race_opponent.content as { text }. The
// column is untyped JSON at runtime, so read the leaf defensively.
const CollectedContentSchema = z
  .object({ text: z.string() })
  .partial()
  .catch({})

// Roster ordering for the read endpoint: primary_threat first, opponents with
// no analysis last. 'none' is the synthetic key for an opponent without a
// persisted threat tier.
const THREAT_TIER_RANK: Record<RaceOpponentThreatTier | 'none', number> = {
  primary_threat: 0,
  watch_closely: 1,
  low_priority: 2,
  none: 3,
}

@Injectable()
export class RaceOpponentService extends createPrismaBase(MODELS.RaceOpponent) {
  constructor(
    private readonly experimentRuns: ExperimentRunsService,
    private readonly electionApi: ElectionApiService,
    private readonly campaignStrategy: CampaignStrategyService,
    private readonly districtResolver: DistrictResolverService,
  ) {
    super()
  }

  // The ownership guard (@UseCampaign) already scopes the campaign to the
  // current user, so reaching here means the caller owns it. Pro is the
  // remaining gate; 4xx so the webapp can branch cleanly. Public so the
  // controller can apply the same Pro gate to opponent routes that don't go
  // through collect() (e.g. opponents/identify).
  async assertAccess(campaign: CampaignWith<'user'>): Promise<void> {
    if (!campaign.isPro) {
      throw new ForbiddenException('Race opponent collection requires Pro.')
    }
    if (!campaign.user) {
      throw new BadRequestException(
        'Campaign has no associated user — check @UseCampaign include.',
      )
    }
  }

  // Server-side auto-trigger for a fresh Pro upgrade (no request user context):
  // get research in flight before the candidate first opens /opponent. Loads the
  // campaign + user itself, then silently no-ops when the user is gone or the
  // campaign isn't Pro — an automated path must not 4xx the way the user-facing
  // assertAccess does. Delegates to collect(), so the same in-flight dedup that
  // guards the "Collect now" button keeps this from double-dispatching a
  // duplicate paid RACE_OPPONENT_COLLECTION run.
  async autoCollectOnProUpgrade(campaignId: number): Promise<void> {
    const campaign = await this.client.campaign.findUnique({
      where: { id: campaignId },
      include: { user: true },
    })
    if (!campaign?.isPro || !campaign.user) return

    await this.collect(campaign)
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

  // Manual-entry path: the candidate names opponents discovery missed (plus
  // optional Ballotpedia/website hints). Unlike collect(), this never reads
  // loadOpposition()/runs discovery — the candidate IS the source. The names
  // are reconciled into the same campaignStrategyOpponent store collect() reads,
  // so a later refresh/poll resolves the same opponents, then collection is
  // dispatched through the shared dispatchCollection path (same in-flight dedup,
  // so a second manual submit while a run is in flight reuses it).
  async collectManual(
    campaign: CampaignWith<'user'>,
    opponents: ManualOpponentsRequest['opponents'],
  ): Promise<RaceOpponentCollectResponse> {
    await this.assertAccess(campaign)

    const clerkUserId = campaign.user?.clerkId
    if (!clerkUserId) {
      throw new BadRequestException(
        'User must be signed in to collect opponent data.',
      )
    }

    // website is the opponent's campaign site, normalized to its apex domain
    // (scheme + www. stripped) so the hint matches the canonical form the rest
    // of the repo persists. ballotpedia_url is a deep page link — keep its path
    // intact, only trim. Both are validated https URLs by the request schema.
    // Normalized once here and used for both persist and dispatch, so a later
    // collect() re-dispatch reads back the same hints.
    const normalized = opponents.map((opponent) => ({
      fullName: opponent.name,
      ballotpediaUrl: opponent.ballotpediaUrl ?? null,
      websiteUrl: opponent.website ? apexDomain(opponent.website) : null,
    }))

    await this.persistManualOpponents(campaign.id, normalized)

    const params: CollectionInput['opponents'][number][] = normalized.map(
      (opponent) => ({
        full_name: opponent.fullName,
        ...(opponent.ballotpediaUrl
          ? { ballotpedia_url: opponent.ballotpediaUrl }
          : {}),
        ...(opponent.websiteUrl ? { website_url: opponent.websiteUrl } : {}),
      }),
    )

    return this.dispatchCollection(campaign, clerkUserId, params)
  }

  // Reconcile the candidate-supplied opponents into the same
  // campaignStrategyOpponent store collect()/loadOpposition() read, so a later
  // refresh resolves the same opponents (and their URL hints) instead of
  // re-running discovery. Upsert the plan row, then add only the names not
  // already present (normalized match, mirroring loadRoster) — additive so a
  // manual add never clobbers a discovered roster. partyAffiliation is required
  // and unknown for a manual entry, so it takes the discovery contract's
  // 'Unknown' sentinel. oppositionPersistedAt is stamped so collect() treats the
  // roster as real (its "discovered, uncontested -> idle" branch keys on this
  // marker) rather than re-triggering discovery on the next poll.
  private async persistManualOpponents(
    campaignId: number,
    opponents: {
      fullName: string
      ballotpediaUrl: string | null
      websiteUrl: string | null
    }[],
  ): Promise<void> {
    await this.client.$transaction(async (tx) => {
      const plan = await tx.campaignStrategy.upsert({
        where: { campaignId },
        create: { campaignId, oppositionPersistedAt: new Date() },
        update: { oppositionPersistedAt: new Date() },
        include: { opponents: true },
      })
      const existing = new Set(
        plan.opponents.map((opponent) =>
          opponent.fullName.trim().toLowerCase(),
        ),
      )
      const toAdd = opponents.filter((opponent) => {
        const key = opponent.fullName.trim().toLowerCase()
        if (existing.has(key)) return false
        existing.add(key)
        return true
      })
      if (toAdd.length > 0) {
        await tx.campaignStrategyOpponent.createMany({
          data: toAdd.map((opponent) => ({
            campaignStrategyId: plan.id,
            fullName: opponent.fullName,
            partyAffiliation: 'Unknown',
            ballotpediaUrl: opponent.ballotpediaUrl,
            websiteUrl: opponent.websiteUrl,
          })),
        })
      }
    })
  }

  // The in-flight dedup + race_opponent_collection dispatch. Reached from
  // collect() once opponent names exist (from the plan, or from a discovery run
  // the page re-fired collect after), and from collectManual() with candidate-
  // supplied names + optional URL hints. The dedup is unchanged from the
  // original. opponents is the collection contract's per-opponent element type
  // so the manual path's optional ballotpedia_url/website_url hints pass through
  // to the agent; the discovery path simply omits them.
  private async dispatchCollection(
    campaign: CampaignWith<'user'>,
    clerkUserId: string,
    opponents: CollectionInput['opponents'][number][],
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
            ExperimentRunStatus.SUPERSEDED,
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

  // Chain the structuring run off a completed collection (called from
  // RaceOpponentPersistService once the collected rows are committed). Reads
  // those rows back, groups them per opponent into the summary input, and
  // dispatches race_opponent_summary. No external call — the input is our own
  // collected text. Skips dispatch when nothing was collected: a summary over
  // zero sources has nothing to structure.
  async dispatchSummary(campaign: CampaignWith<'user'>): Promise<void> {
    const clerkUserId = campaign.user?.clerkId
    if (!clerkUserId) return

    const rows = await this.model.findMany({
      where: { campaignId: campaign.id },
      orderBy: { createdAt: Prisma.SortOrder.asc },
    })

    const opponents = this.groupSourcesForSummary(rows)
    if (opponents.length === 0) return

    // Reuse an already-in-flight summary run instead of dispatching a second:
    // a collection that completes while a prior summary run is still going
    // would otherwise spawn a duplicate whose replaceSummaries (delete-then-
    // insert) races the first's, leaving a non-deterministic final state.
    // Mirrors dispatchCollection's in-flight dedup; not a hard claim, but it
    // closes the common chained-retry case.
    const inFlight = await this.client.experimentRun.findFirst({
      where: {
        organizationSlug: campaign.organizationSlug,
        experimentType: RACE_OPPONENT_SUMMARY,
        status: {
          in: [
            ExperimentRunStatus.QUEUED,
            ExperimentRunStatus.RUNNING,
            ExperimentRunStatus.AWAITING_RESUME,
            ExperimentRunStatus.SUPERSEDED,
          ],
        },
      },
      orderBy: { createdAt: Prisma.SortOrder.desc },
      select: { runId: true },
    })
    if (inFlight) return

    await this.experimentRuns.dispatchRun({
      type: RACE_OPPONENT_SUMMARY,
      organizationSlug: campaign.organizationSlug,
      clerkUserId,
      params: {
        // The contract types opponents as a non-empty tuple; the
        // empty-array case is filtered out above, but the type can't prove it.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        opponents: opponents as SummaryInput['opponents'],
        candidate_platform: await this.buildCandidatePlatform(campaign.id),
        race_context: await this.buildRaceContext(campaign),
      },
    })
  }

  // Re-chain a summary when a collection newer than the just-finished summary
  // run has completed. Called on summary completion: if a fresh collection
  // landed while this summary was in flight, its rows replaced the ones this
  // summary structured (and replaceForCampaign cleared the summaries), but
  // dispatchSummary's in-flight dedup skipped chaining a summary for it. Now
  // that this run is terminal, dispatch the deferred summary so the new rows get
  // structured — otherwise collectionStatus stays 'running' forever, because the
  // newest summary run pre-dates the newest collection and never counts as the
  // current cycle's summary (ENG-10614). No-op in the common single-cycle case:
  // the only completed collection there pre-dates its own chained summary run.
  async rechainSummaryForNewerCollection(
    campaign: CampaignWith<'user'>,
    summaryRunCreatedAt: Date,
  ): Promise<void> {
    const latestCollection = await this.client.experimentRun.findFirst({
      where: {
        organizationSlug: campaign.organizationSlug,
        experimentType: RACE_OPPONENT_COLLECTION,
        status: ExperimentRunStatus.COMPLETED,
      },
      orderBy: { createdAt: Prisma.SortOrder.desc },
      select: { createdAt: true },
    })
    if (
      latestCollection &&
      isAfter(latestCollection.createdAt, summaryRunCreatedAt)
    ) {
      await this.dispatchSummary(campaign)
    }
  }

  // Chain the stand-out-actions run off a completed summary (called from
  // RaceOpponentPersistService once the summary rows are committed), mirroring
  // how dispatchSummary chains off a completed collection. Reads the persisted
  // summaries back, flattens each into the plain-text actions input, and
  // dispatches race_opponent_actions. Skips dispatch when no summaries
  // persisted: there is nothing to build cards from.
  async dispatchActions(campaign: CampaignWith<'user'>): Promise<void> {
    const clerkUserId = campaign.user?.clerkId
    if (!clerkUserId) return

    const opponents = await this.buildActionsOpponents(campaign.id)
    if (opponents.length === 0) return

    // Reuse an already-in-flight actions run instead of dispatching a second:
    // a summary that completes while a prior actions run is still going would
    // otherwise spawn a duplicate paid run. Mirrors dispatchSummary's in-flight
    // dedup; not a hard claim, but it closes the common chained-retry case.
    const inFlight = await this.client.experimentRun.findFirst({
      where: {
        organizationSlug: campaign.organizationSlug,
        experimentType: RACE_OPPONENT_ACTIONS,
        status: {
          in: [
            ExperimentRunStatus.QUEUED,
            ExperimentRunStatus.RUNNING,
            ExperimentRunStatus.AWAITING_RESUME,
            ExperimentRunStatus.SUPERSEDED,
          ],
        },
      },
      orderBy: { createdAt: Prisma.SortOrder.desc },
      select: { runId: true },
    })
    if (inFlight) return

    const candidatePlatform = await this.buildCandidatePlatform(campaign.id)
    const district = await this.districtResolver.resolveByOrgSlug(
      campaign.organizationSlug,
    )

    await this.experimentRuns.dispatchRun({
      type: RACE_OPPONENT_ACTIONS,
      organizationSlug: campaign.organizationSlug,
      clerkUserId,
      params: {
        // The contract types opponents as a non-empty tuple; the
        // empty-array case is filtered out above, but the type can't prove it.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        opponents: opponents as ActionsInput['opponents'],
        ...(candidatePlatform ? { candidate_platform: candidatePlatform } : {}),
        // FLAT district params, all-or-nothing: the dispatch Lambda's scope
        // derivation reads params.state top-level and reserves a nested
        // 'district' object (it would fail dispatch). No resolution = omit all
        // three so the agent skips Databricks (haystaq_status: no_district).
        ...(district
          ? {
              state: district.state,
              l2_district_type: district.l2DistrictType,
              l2_district_name: district.l2DistrictName,
            }
          : {}),
        race_context: await this.buildRaceContext(campaign),
      },
    })
  }

  // Re-chain an actions run when a summary newer than the just-finished
  // actions run has completed — the same deferred-chain problem
  // rechainSummaryForNewerCollection solves one link earlier: a fresh summary
  // that landed while this actions run was in flight had its chained dispatch
  // skipped by dispatchActions' in-flight dedup, so its cards would never be
  // regenerated. Called on every terminal actions outcome.
  async rechainActionsForNewerSummary(
    campaign: CampaignWith<'user'>,
    actionsRunCreatedAt: Date,
  ): Promise<void> {
    const latestSummary = await this.client.experimentRun.findFirst({
      where: {
        organizationSlug: campaign.organizationSlug,
        experimentType: RACE_OPPONENT_SUMMARY,
        status: ExperimentRunStatus.COMPLETED,
      },
      orderBy: { createdAt: Prisma.SortOrder.desc },
      select: { createdAt: true },
    })
    if (
      latestSummary &&
      isAfter(latestSummary.createdAt, actionsRunCreatedAt)
    ) {
      await this.dispatchActions(campaign)
    }
  }

  // Flatten the persisted summaries into the actions input: plain section text
  // only, re-validated through the contract on read (same as loadSummaries) —
  // never raw JSON. The actions contract requires a threat tier (it drives
  // card ordering), so a legacy v1 row without one contributes no entry.
  private async buildActionsOpponents(
    campaignId: number,
  ): Promise<ActionsInput['opponents'][number][]> {
    const rows = await this.client.raceOpponentSummary.findMany({
      where: { campaignId },
    })
    return rows.flatMap((row) => {
      const parsed = RaceOpponentSummarySchema.safeParse(row.sections)
      if (!parsed.success) {
        this.logger.warn(
          { campaignId, opponentName: row.opponentName },
          'persisted opponent summary failed contract re-parse; omitting',
        )
        return []
      }
      const summary = parsed.data
      if (!summary.threatTier) return []
      return [
        {
          opponent_name: summary.opponentName,
          threat_tier: summary.threatTier,
          overview_text: summary.overview
            ? capActionsText(summary.overview.text)
            : null,
          background_text: summary.background
            ? capActionsText(summary.background.text)
            : null,
          issues_that_matter:
            summary.issuesThatMatter?.items.map(capActionsText) ?? null,
        },
      ]
    })
  }

  // The candidate's own platform (bio + issues), read from
  // Website.content.about — the pre-Pro-upgrade CandidateProfileStep capture,
  // NOT CampaignStory (the self-research duplicate we avoid). Returns undefined
  // when the campaign has no website bio or issues yet, so dispatch omits the
  // field and the agent produces no issue contrasts. Public so the strict
  // OpponentResearchService can source its candidate_platform from the same
  // place rather than re-implementing the Website read.
  async buildCandidatePlatform(
    campaignId: number,
  ): Promise<SummaryInput['candidate_platform'] | undefined> {
    const website = await this.client.website.findUnique({
      where: { campaignId },
      select: { content: true },
    })
    const about = website?.content?.about
    if (!about) return undefined

    const bio = about.bio?.trim() ? about.bio : undefined
    const issues = (about.issues ?? []).flatMap((issue) =>
      issue.title?.trim() && issue.description?.trim()
        ? [{ title: issue.title, description: issue.description }]
        : [],
    )

    if (!bio && issues.length === 0) return undefined
    return {
      ...(bio ? { bio } : {}),
      ...(issues.length > 0 ? { issues } : {}),
    }
  }

  // Group the flat collected rows into the summary input's per-opponent
  // sources[]. Only the two web-discovered source types the summary contract
  // accepts are passed through; campaign_plan_db rows (a later phase) are
  // skipped. An opponent whose every row was skipped contributes no entry.
  private groupSourcesForSummary(
    rows: RaceOpponentRow[],
  ): SummaryInput['opponents'][number][] {
    const byName = new Map<string, SummaryInput['opponents'][number]>()
    for (const row of rows) {
      if (
        row.sourceType !== RaceOpponentSourceType.ballotpedia &&
        row.sourceType !== RaceOpponentSourceType.opponent_website
      ) {
        continue
      }
      if (!row.sourceUrl) continue

      const entry = byName.get(row.opponentName) ?? {
        opponent_name: row.opponentName,
        sources: [],
      }
      entry.sources.push({
        source_type: row.sourceType,
        source_url: row.sourceUrl,
        text: CollectedContentSchema.parse(row.content).text ?? '',
      })
      byName.set(row.opponentName, entry)
    }
    return [...byName.values()].filter((entry) => entry.sources.length > 0)
  }

  async get(campaign: CampaignWith<'user'>): Promise<RaceOpponentResponse> {
    await this.assertAccess(campaign)

    const rows = await this.model.findMany({
      where: { campaignId: campaign.id },
      orderBy: { createdAt: Prisma.SortOrder.asc },
    })

    const collectionStatus = await this.collectionStatus(
      campaign.id,
      campaign.organizationSlug,
    )

    return {
      opponents: this.groupByOpponent(
        rows,
        await this.loadRoster(campaign.id),
        await this.loadSummaries(campaign.id),
        collectionStatus,
      ),
      lastCollectedAt: this.lastCollectedAt(rows),
      collectionStatus,
      fieldAnalysis: await this.loadFieldAnalysis(campaign.id),
      standoutActions: await this.loadStandoutActions(campaign.id),
    }
  }

  // The persisted stand-out action cards, in artifact order. Re-validated
  // against the contract on read, mirroring loadSummaries/loadFieldAnalysis:
  // a row that somehow doesn't parse is omitted rather than 500-ing the whole
  // read. Always an array — empty when the campaign has no cards.
  private async loadStandoutActions(
    campaignId: number,
  ): Promise<RaceOpponentStandoutAction[]> {
    const rows = await this.client.raceOpponentStandoutAction.findMany({
      where: { campaignId },
      orderBy: { order: Prisma.SortOrder.asc },
    })
    return rows.flatMap((row) => {
      const parsed = RaceOpponentStandoutActionSchema.safeParse({
        title: row.title,
        body: row.body,
        smsMessage: row.smsMessage,
        opponentName: row.opponentName,
        issue: row.issue,
      })
      if (!parsed.success) {
        this.logger.warn(
          { campaignId, order: row.order },
          'persisted stand-out action failed contract re-parse; omitting',
        )
        return []
      }
      return [parsed.data]
    })
  }

  // The persisted campaign-level SWOT (one row per campaign). Re-validated
  // against the contract on read, mirroring loadSummaries: a row that somehow
  // doesn't parse is omitted rather than 500-ing the whole read.
  private async loadFieldAnalysis(
    campaignId: number,
  ): Promise<RaceOpponentFieldAnalysis | null> {
    const row = await this.client.raceOpponentFieldAnalysis.findUnique({
      where: { campaignId },
    })
    if (!row) return null

    const parsed = RaceOpponentFieldAnalysisSchema.safeParse(row.sections)
    if (!parsed.success) {
      this.logger.warn(
        { campaignId },
        'persisted field analysis failed contract re-parse; omitting',
      )
      return null
    }
    return parsed.data
  }

  // The persisted structured summaries (one row per opponent). Keyed by the
  // NORMALIZED opponent name (trim + lowercase, same as the roster lookup):
  // the summary row and the race_opponent rows come from two separate LLM
  // runs, so their casing/whitespace can differ — a raw-key match would
  // silently drop the summary from the response. The persist path already
  // validated sections against the contract before writing, so a stored row
  // re-parses cleanly; a row that somehow doesn't is dropped rather than
  // 500-ing the whole read.
  private async loadSummaries(
    campaignId: number,
  ): Promise<Map<string, RaceOpponentSummary>> {
    const summaries = await this.client.raceOpponentSummary.findMany({
      where: { campaignId },
    })
    const byName = new Map<string, RaceOpponentSummary>()
    for (const summary of summaries) {
      const parsed = RaceOpponentSummarySchema.safeParse(summary.sections)
      if (parsed.success) {
        byName.set(summary.opponentName.trim().toLowerCase(), parsed.data)
      } else {
        this.logger.warn(
          { campaignId, opponentName: summary.opponentName },
          'persisted opponent summary failed contract re-parse; omitting',
        )
      }
    }
    return byName
  }

  // The campaign-strategy opponent roster (already populated by the plan;
  // CampaignStrategyOpponent carries party + incumbency). Read here only to
  // enrich the grouped response — no new external call, this is the same
  // relation collect() reads via loadOpposition. Keyed by normalized name so
  // groupByOpponent can resolve party/incumbency per collected opponent.
  // `displayName` preserves the original fullName so groupByOpponent can
  // surface a rostered opponent with no collected rows using their real
  // casing (ENG-10893).
  private async loadRoster(campaignId: number): Promise<
    Map<
      string,
      {
        party: string | null
        isIncumbent: boolean | null
        websiteUrl: string | null
        displayName: string
      }
    >
  > {
    const plan = await this.client.campaignStrategy.findUnique({
      where: { campaignId },
      include: { opponents: true },
    })
    const byName = new Map<
      string,
      {
        party: string | null
        isIncumbent: boolean | null
        websiteUrl: string | null
        displayName: string
      }
    >()
    for (const opponent of plan?.opponents ?? []) {
      byName.set(opponent.fullName.trim().toLowerCase(), {
        party: opponent.partyAffiliation,
        isIncumbent: opponent.incumbent ?? null,
        websiteUrl: opponent.websiteUrl ?? null,
        displayName: opponent.fullName.trim(),
      })
    }
    return byName
  }

  private async buildOpponents(
    campaignId: number,
  ): Promise<CollectionInput['opponents'][number][]> {
    return (await this.loadOpposition(campaignId)).opponents
  }

  // The plan's opponents plus its opposition persist marker, read in one query.
  // collect() needs both: the marker distinguishes "never discovered" (trigger
  // discovery) from "discovered, uncontested" (settle to idle). The persisted
  // URL hints (set on the manual-entry path; null for discovery-seeded
  // opponents) ride along so a collect() re-dispatch — e.g. a retry after a
  // FAILED run — keeps the candidate-supplied Ballotpedia/website starting
  // points. Absent hints omit the key so the discovery-seeded path is unchanged.
  private async loadOpposition(campaignId: number): Promise<{
    opponents: CollectionInput['opponents'][number][]
    oppositionPersistedAt: Date | null
  }> {
    const plan = await this.client.campaignStrategy.findUnique({
      where: { campaignId },
      include: { opponents: true },
    })
    return {
      opponents: (plan?.opponents ?? []).map((o) => ({
        full_name: o.fullName,
        ...(o.ballotpediaUrl ? { ballotpedia_url: o.ballotpediaUrl } : {}),
        ...(o.websiteUrl ? { website_url: o.websiteUrl } : {}),
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
    roster: Map<
      string,
      {
        party: string | null
        isIncumbent: boolean | null
        websiteUrl: string | null
        displayName: string
      }
    >,
    summaries: Map<string, RaceOpponentSummary>,
    collectionStatus: RaceOpponentCollectionStatus,
  ): RaceOpponentResponse['opponents'] {
    const byName = new Map<string, RaceOpponent[]>()
    // Collected opponent_website rows are the primary websiteUrl source (the
    // opponent's own site, as actually reached by the collection agent); the
    // roster's manual-entry hint is only a fallback for an opponent collection
    // never found a website for.
    const websiteUrlByName = new Map<string, string>()
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
      if (
        row.sourceType === RaceOpponentSourceType.opponent_website &&
        row.sourceUrl
      ) {
        websiteUrlByName.set(row.opponentName, row.sourceUrl)
      }
    }
    // Seed rostered opponents that have zero collected rows (ENG-10893). The
    // plan's Executive Summary/Opposition Research reads the same roster and
    // would otherwise diverge from KYO when the collection agent found no
    // public sources for a rostered name (a match falls out of the response
    // entirely rather than rendering with empty items). Match on the same
    // normalized (trim+lowercase) key groupByOpponent uses to enrich, so an
    // opponent whose collected rows just differ in casing/whitespace from the
    // roster still deduplicates onto their collected entry.
    //
    // A 'failed' collection is exempt. RaceOpponentList gates its "Collection
    // failed / Try again" card on an empty opponents[], so seeding roster names
    // into a failed response replaces the candidate's only retry path with a
    // report of names carrying no research (ENG-10893 review follow-up).
    if (collectionStatus !== 'failed') {
      const collectedNormalized = new Set<string>()
      for (const opponentName of byName.keys()) {
        collectedNormalized.add(opponentName.trim().toLowerCase())
      }
      for (const [normalized, rosterEntry] of roster.entries()) {
        if (collectedNormalized.has(normalized)) continue
        byName.set(rosterEntry.displayName, [])
      }
    }
    const grouped = [...byName.entries()].map(([opponentName, items]) => {
      // Conservative name match against the roster: trim + lowercase only
      // (mirrors opponentResearch.matchRosterCandidate). No match => both null
      // rather than mis-attributing a party badge.
      const match = roster.get(opponentName.trim().toLowerCase())
      const summary = summaries.get(opponentName.trim().toLowerCase()) ?? null
      return {
        opponentName,
        party: match?.party ?? null,
        isIncumbent: match?.isIncumbent ?? null,
        // Surfaced on the opponent object (mirrors summary.threatTier) so the
        // roster can tier and order without opening the detail.
        threatTier: summary?.threatTier,
        websiteUrl:
          websiteUrlByName.get(opponentName) ?? match?.websiteUrl ?? null,
        // Raw items back only the no-summary fallback in the UI; once a
        // structured summary exists they are redundant, so omit them instead
        // of shipping the full scraped page text (ENG-10622).
        ...(summary ? {} : { items }),
        summary,
      }
    })

    // Order primary_threat -> watch_closely -> low_priority -> no-analysis last
    // (matching the Lovable layout). threatTier lives in the summary JSON, so
    // the ordering happens here in the service rather than via a Prisma orderBy.
    // Array.prototype.sort is stable, so ties keep the collected (createdAt-asc)
    // order the map preserved.
    return grouped.sort(
      (a, b) =>
        THREAT_TIER_RANK[a.threatTier ?? 'none'] -
        THREAT_TIER_RANK[b.threatTier ?? 'none'],
    )
  }

  private lastCollectedAt(rows: RaceOpponentRow[]): Date | null {
    const [first] = rows
    if (!first) return null
    return rows.reduce(
      (latest, row) => (row.createdAt > latest ? row.createdAt : latest),
      first.createdAt,
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
      select: { runId: true, status: true, createdAt: true },
    })
    if (run) {
      switch (run.status) {
        case ExperimentRunStatus.COMPLETED:
          return this.postCollectionStatus(
            campaignId,
            organizationSlug,
            run.runId,
            run.createdAt,
          )
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
      discovery.status === ExperimentRunStatus.AWAITING_RESUME ||
      discovery.status === ExperimentRunStatus.SUPERSEDED
    return inFlight ? 'discovering' : 'idle'
  }

  // The relaxed path chains a race_opponent_summary run off a completed
  // collection to structure the raw collected text into the analysis the page
  // renders. So a COMPLETED collection run is NOT the whole pipeline finishing:
  // report 'running' until that summary phase settles, otherwise the page
  // leaves the progress screen and flashes the raw collected rows while the
  // summary is still in flight (ENG-10614). Still derived purely from run state
  // (+ whether any rows were collected), so nothing strands: an empty
  // collection has no summary to await, and a FAILED summary degrades to
  // 'completed' — the raw rows are shown as a fallback rather than trapping the
  // user on the progress screen forever.
  private async postCollectionStatus(
    campaignId: number,
    organizationSlug: string,
    collectionRunId: string,
    collectionRunCreatedAt: Date,
  ): Promise<RaceOpponentCollectionStatus> {
    const summary = await this.client.experimentRun.findFirst({
      where: {
        organizationSlug,
        experimentType: RACE_OPPONENT_SUMMARY,
      },
      orderBy: { createdAt: Prisma.SortOrder.desc },
      select: { status: true, createdAt: true },
    })

    // Only a summary dispatched AFTER this collection run belongs to its cycle
    // (dispatchSummary fires once the collection COMPLETES, so its run is always
    // newer). An older COMPLETED summary is from a prior collection whose rows
    // were since replaced, so it must not mask the current cycle's pending
    // summary as 'completed'.
    if (summary && isAfter(summary.createdAt, collectionRunCreatedAt)) {
      const settled =
        summary.status === ExperimentRunStatus.COMPLETED ||
        summary.status === ExperimentRunStatus.FAILED
      return settled ? 'completed' : 'running'
    }

    // No summary run belongs to this cycle. Did THIS collection run produce the
    // current rows? replaceForCampaign stamps every row it writes with the
    // collection's runId, and an empty re-collection writes nothing (early
    // return, dispatching no summary). So rows carrying this run's id mean it
    // collected fresh data whose chained summary is in flight or imminent (the
    // brief gap before dispatchSummary creates the run) — keep processing.
    // Otherwise there are no rows at all, or only a prior cycle's rows a later
    // empty re-collection preserved: no summary is coming for this run, so the
    // status settles to 'completed' rather than stranding on 'running'
    // (ENG-10614). This also self-heals the overlapping-collection case: the
    // fresh rows read 'running' until the re-chained summary lands and, being
    // newer, is caught by the branch above.
    const freshRows = await this.model.count({
      where: { campaignId, runId: collectionRunId },
    })
    return freshRows > 0 ? 'running' : 'completed'
  }
}

// Reduce a candidate-supplied website URL to its apex domain (scheme + www.
// stripped) so the agent hint matches the canonical form the rest of the repo
// persists for website input. The URL is a validated https URL by here, so the
// parse can't throw.
const apexDomain = (url: string): string =>
  new URL(url).hostname.replace(/^www\./, '')

const capActionsText = (text: string): string =>
  text.slice(0, MAX_ACTIONS_TEXT_CHARS)
