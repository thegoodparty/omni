import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { z } from 'zod'
import {
  IdentifyOpponentsResponse,
  OpponentProfileResponse,
  StartOpponentResearchRequest,
  StartOpponentResearchResponse,
  RaceOpponentResearch,
} from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { isUniqueConstraintError } from '@/prisma/util/prismaErrors.util'
import {
  Prisma,
  RaceOpponentFindingKind,
  RaceOpponentResearchStatus,
  RaceOpponentResearch as RaceOpponentResearchRow,
  RaceOpponentFinding as RaceOpponentFindingRow,
} from '@/generated/prisma'
import { CampaignWith } from '@/campaigns/campaigns.types'
import { ExperimentRunsService } from '@/agentExperiments/services/experimentRuns.service'
import { AgentJobContracts } from '@/generated/agent-job-contracts'
import { ElectionApiService } from '@/campaignStrategy/services/electionApi.service'
import { RaceContextFromApi } from '@/campaignStrategy/types/electionApi.types'
import { getUserFullName } from '@/users/util/users.util'
import { serializeWebsiteIssues } from '@/websites/util/serializeWebsiteIssues.util'
import { RaceOpponentService } from './raceOpponent.service'
import { SelfResearchGateService } from './selfResearchGate.service'
import {
  MAX_OPPONENT_RESEARCH_ATTEMPTS,
  OPPONENT_RESEARCH,
} from '../raceOpponent.constants'

type OpponentResearchInput = AgentJobContracts['opponent_research']['Input']
type CandidatePlatform = NonNullable<
  OpponentResearchInput['candidate_platform']
>

// The PMF Engine rejects dispatch params over 6000 bytes (it serializes them the
// wider, spaced way Python json.dumps does). candidate_platform is candidate-
// authored free text — why/background/issues each cap at 10k chars, ~30k total,
// well over the limit on their own — but it is context-only (the agent frames
// contrasts from it and never researches the candidate), so trim it to fit.
// Budget against compact JSON.stringify under 6000 so the agent's wider spacing
// still fits.
const MAX_PARAMS_BYTES = 5000

// Descending relevance to opponent contrasts: issues (what the candidate runs
// on) frames contrasts most directly, then why (motivation), then background
// (bio). The budget fills fields in this order and drops what overflows.
const PLATFORM_FIELDS = ['issues', 'why', 'background'] as const

const paramsBytes = (params: OpponentResearchInput): number =>
  Buffer.byteLength(JSON.stringify(params))

// Truncate to at most maxBytes of UTF-8 without splitting a multibyte character
// (the cap is measured in bytes, and e.g. one emoji is one JS char but 4 bytes).
const truncateToBytes = (value: string, maxBytes: number): string => {
  if (maxBytes <= 0) return ''
  const buf = Buffer.from(value, 'utf8')
  if (buf.length <= maxBytes) return value
  let end = maxBytes
  // Back off out of a continuation byte (0b10xxxxxx) to cut on a char boundary.
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end--
  return buf.toString('utf8', 0, end)
}

// Shrink candidate_platform so the serialized params fit the dispatch cap; a
// payload already under it (the common case) is returned untouched. Fields are
// kept in PLATFORM_FIELDS order, each byte-truncated to the headroom the fixed
// payload and higher-priority fields leave. JSON escaping makes a serialized
// field larger than its raw bytes, so each field is re-measured and a single
// corrective truncation by the measured excess brings it back under the cap
// (removing N raw bytes removes at least N escaped bytes).
const fitPlatform = (params: OpponentResearchInput): OpponentResearchInput => {
  if (paramsBytes(params) <= MAX_PARAMS_BYTES) return params
  const platform = params.candidate_platform
  if (!platform) return params

  const trimmed: CandidatePlatform = {}
  for (const field of PLATFORM_FIELDS) {
    const value = platform[field]
    if (!value) continue
    const headroom =
      MAX_PARAMS_BYTES - paramsBytes({ ...params, candidate_platform: trimmed })
    if (headroom <= 0) break
    trimmed[field] = truncateToBytes(value, headroom)
    const excess =
      paramsBytes({ ...params, candidate_platform: trimmed }) - MAX_PARAMS_BYTES
    if (excess > 0) {
      const kept = trimmed[field] ?? ''
      trimmed[field] = truncateToBytes(kept, Buffer.byteLength(kept) - excess)
    }
    if (!trimmed[field]) delete trimmed[field]
  }
  return { ...params, candidate_platform: trimmed }
}

// Only the campaign-details keys this module reads; the column is untyped JSON
// at runtime, so each leaf is independently fault-tolerant.
const lenientString = z.string().nullable().optional().catch(null)
const CampaignDetailsSchema = z
  .object({ raceId: lenientString, city: lenientString })
  .partial()

@Injectable()
export class OpponentResearchService extends createPrismaBase(
  MODELS.RaceOpponentResearch,
) {
  constructor(
    private readonly raceOpponent: RaceOpponentService,
    private readonly selfResearchGate: SelfResearchGateService,
    private readonly experimentRuns: ExperimentRunsService,
    private readonly electionApi: ElectionApiService,
  ) {
    super()
  }

  // Pro + flag gate (RaceOpponentService.assertAccess) AND the self-research
  // hard gate (PRD Requirement B): both must pass before any opponent path runs.
  private async assertGates(campaign: CampaignWith<'user'>): Promise<void> {
    await this.raceOpponent.assertAccess(campaign)
    await this.selfResearchGate.assertSelfResearchComplete(campaign.id)
  }

  // Default the opponent set from the election-api candidacy roster so the
  // candidate confirms a real match rather than typing a free-text namesake.
  // The candidate's own name is excluded; a missing race / election-api outage
  // degrades to an empty list (the page can still let the user enter a name).
  async identify(
    campaign: CampaignWith<'user'>,
  ): Promise<IdentifyOpponentsResponse> {
    await this.assertGates(campaign)

    const raceContext = await this.tryRaceContext(campaign)
    if (!raceContext) return { opponentNames: [] }

    // assertGates -> assertAccess already 400s when user is absent; this narrows
    // the type for getUserFullName, which requires a non-null user.
    const user = campaign.user
    const ownName = user ? getUserFullName(user).trim().toLowerCase() : ''
    const opponentNames = raceContext.candidates
      .map((c) => c.fullName)
      .filter((name) => name.trim().length > 0)
      .filter((name) => name.trim().toLowerCase() !== ownName)

    return { opponentNames: [...new Set(opponentNames)] }
  }

  async start(
    campaign: CampaignWith<'user'>,
    request: StartOpponentResearchRequest,
  ): Promise<StartOpponentResearchResponse> {
    await this.assertGates(campaign)

    const clerkUserId = campaign.user?.clerkId
    if (!clerkUserId) {
      throw new BadRequestException(
        'User must be signed in to research an opponent.',
      )
    }

    // Confirmation is the request itself: an opponentName must be supplied by
    // the candidate. We never auto-dispatch on an unconfirmed namesake — the
    // identify route surfaces defaults, but the candidate picks the match.
    const opponentName = request.opponentName.trim()
    if (opponentName.length === 0) {
      throw new BadRequestException('opponentName is required.')
    }

    const existing = await this.opponentRow(campaign.id, opponentName)

    // Reuse an already-settled or in-flight pass rather than dispatching a
    // duplicate paid run. completed is included: re-running a finished pass is a
    // separate explicit path (out of scope here). A second POST returns what's
    // there.
    if (
      existing &&
      (existing.status === RaceOpponentResearchStatus.queued ||
        existing.status === RaceOpponentResearchStatus.running ||
        existing.status === RaceOpponentResearchStatus.completed)
    ) {
      return { research: this.toResearch(existing) }
    }

    if (existing && existing.attempts >= MAX_OPPONENT_RESEARCH_ATTEMPTS) {
      throw new BadRequestException(
        'Opponent research has failed repeatedly. Please try again later.',
      )
    }

    const bound = await this.claimAndDispatch(campaign, clerkUserId, {
      existing,
      opponentName,
      electionCandidacyId: request.electionCandidacyId ?? null,
    })

    return { research: this.toResearch(bound) }
  }

  // Scheduled re-dispatch entry: force a fresh opponent_research run for an
  // already-persisted opponent row, bypassing start()'s reuse-completed early
  // return (a completed pass is exactly what the schedule refreshes). The
  // attempt cap still bounds a row that keeps failing, and replace-on-persist
  // keyed by runId means the next run's findings supersede this row's without
  // duplicating. Returns false when nothing was dispatched (cap reached or
  // dispatch unavailable) so the cron can count it.
  async redispatchForRow(
    campaign: CampaignWith<'user'>,
    row: RaceOpponentResearchRow,
  ): Promise<boolean> {
    const clerkUserId = campaign.user?.clerkId
    if (!clerkUserId) return false
    if (!row.opponentName) return false
    if (row.attempts >= MAX_OPPONENT_RESEARCH_ATTEMPTS) return false

    // Build params before claiming so a params failure can't leave a claimed
    // row stranded in queued (mirrors the user start() ordering).
    const params = await this.buildParams(campaign, row.opponentName)

    // Atomic settled->queued claim. The cron's hasInFlightRun check reads the
    // ExperimentRun table, but a concurrent user start() flips the row to
    // queued (runId still null) BEFORE its dispatchRun creates an ExperimentRun
    // — so a read-then-write re-check would still race and double-dispatch.
    // Making the status transition itself the guard (updateMany WHERE
    // status IN (completed, failed)) means exactly one path can move the row out
    // of settled; if count===0 another path already claimed it, so we skip.
    const { count } = await this.model.updateMany({
      where: {
        id: row.id,
        status: {
          in: [
            RaceOpponentResearchStatus.completed,
            RaceOpponentResearchStatus.failed,
          ],
        },
      },
      data: {
        status: RaceOpponentResearchStatus.queued,
        runId: null,
        attempts: { increment: 1 },
        completedAt: null,
      },
    })
    if (count === 0) return false

    try {
      await this.dispatchAndBind(campaign, clerkUserId, row.id, params)
      return true
    } catch (error) {
      this.logger.error(
        { err: error, campaignId: campaign.id, opponentRowId: row.id },
        'scheduled opponent_research re-dispatch failed for row; continuing',
      )
      // dispatchAndBind already attempts rollbackClaim, but that rollback is
      // swallowed on failure — leaving the row queued/runId:null, which the cron
      // never re-selects (it queries only completed/failed) and hasInFlightRun
      // can't recover (no ExperimentRun). Secondary rollback scoped to a
      // still-queued row so it self-heals next tick; the user path is unaffected
      // (it surfaces dispatch errors to the caller instead).
      await this.model
        .updateMany({
          where: { id: row.id, status: RaceOpponentResearchStatus.queued },
          data: {
            status: RaceOpponentResearchStatus.failed,
            attempts: { decrement: 1 },
          },
        })
        .catch((err: unknown) =>
          this.logger.error(
            { err, opponentRowId: row.id },
            'secondary rollback also failed; row may remain stuck in queued',
          ),
        )
      return false
    }
  }

  // Claim the row BEFORE the external dispatch (DB-claim-before-external-call):
  // queued with runId still null and attempts incremented. If dispatch then
  // fails, the claim is rolled back to failed (scoped to this exact row) so the
  // user can retry — no ExperimentRun/SQS orphan with no research row to
  // receive its result. Shared by the user-driven start() and the scheduled
  // re-dispatch so the two paths can't drift on claim/dispatch/bind ordering.
  private async claimAndDispatch(
    campaign: CampaignWith<'user'>,
    clerkUserId: string,
    opts: {
      existing: RaceOpponentResearchRow | null
      opponentName: string
      electionCandidacyId: string | null
    },
  ): Promise<RaceOpponentResearchRow> {
    const params = await this.buildParams(campaign, opts.opponentName)

    let claimed: RaceOpponentResearchRow
    if (opts.existing) {
      claimed = await this.model.update({
        where: { id: opts.existing.id },
        data: {
          status: RaceOpponentResearchStatus.queued,
          runId: null,
          attempts: { increment: 1 },
          completedAt: null,
          electionCandidacyId: opts.electionCandidacyId,
        },
      })
    } else {
      try {
        claimed = await this.model.create({
          data: {
            campaignId: campaign.id,
            kind: RaceOpponentFindingKind.opponent,
            opponentName: opts.opponentName,
            electionCandidacyId: opts.electionCandidacyId,
            status: RaceOpponentResearchStatus.queued,
            attempts: 1,
          },
        })
      } catch (error) {
        // Concurrent POST won the (campaignId, opponent, opponentName) claim.
        // The loser trips P2002 here — surface the winner's in-flight row
        // instead of dispatching a duplicate run.
        if (isUniqueConstraintError(error)) {
          const winner = await this.opponentRow(campaign.id, opts.opponentName)
          if (winner) return winner
        }
        throw error
      }
    }

    return this.dispatchAndBind(campaign, clerkUserId, claimed.id, params)
  }

  // Dispatch the agent run for an already-claimed row, then bind its runId.
  // Both the user start() claim and the cron's atomic settled->queued claim
  // feed into this so the dispatch/bind/rollback ordering stays single-sourced.
  // On any dispatch or bind failure the claim is rolled back (scoped to this
  // row id) so it never sits queued-with-null-runId.
  private async dispatchAndBind(
    campaign: CampaignWith<'user'>,
    clerkUserId: string,
    claimedId: number,
    params: OpponentResearchInput,
  ): Promise<RaceOpponentResearchRow> {
    let run: Awaited<ReturnType<typeof this.experimentRuns.dispatchRun>>
    try {
      run = await this.experimentRuns.dispatchRun({
        type: OPPONENT_RESEARCH,
        organizationSlug: campaign.organizationSlug,
        clerkUserId,
        params,
      })
    } catch (error) {
      await this.rollbackClaim(claimedId)
      throw error
    }

    if (!run) {
      await this.rollbackClaim(claimedId)
      throw new BadRequestException(
        'Opponent research is not available in this environment.',
      )
    }

    // Bind the dispatched run to the claimed row so onExperimentRunCompleted's
    // by-runId lookup resolves. Runs before any callback can arrive (QUEUED on
    // SQS). If the bind throws, roll the row to failed so the user can
    // re-trigger — the row is never left queued-with-null-runId.
    try {
      return await this.model.update({
        where: { id: claimedId },
        data: { runId: run.runId },
      })
    } catch (error) {
      await this.rollbackClaim(claimedId)
      throw error
    }
  }

  async profile(
    campaign: CampaignWith<'user'>,
    opponentName: string,
  ): Promise<OpponentProfileResponse> {
    await this.assertGates(campaign)

    const name = opponentName.trim()
    if (name.length === 0) {
      throw new BadRequestException('opponentName is required.')
    }

    const row = await this.model.findFirst({
      where: {
        campaignId: campaign.id,
        kind: RaceOpponentFindingKind.opponent,
        opponentName: name,
      },
      include: { findings: { orderBy: { createdAt: Prisma.SortOrder.asc } } },
    })

    if (!row) {
      throw new NotFoundException('No opponent-research pass found.')
    }

    return {
      research: {
        ...this.toResearch(row),
        findings: row.findings.map((f) => this.toFinding(f)),
      },
    }
  }

  private opponentRow(campaignId: number, opponentName: string) {
    return this.model.findFirst({
      where: {
        campaignId,
        kind: RaceOpponentFindingKind.opponent,
        opponentName,
      },
    })
  }

  // Scope the rollback to the exact claimed row id so a concurrent retry's
  // active claim can't be cleared by this caller's late failure. Swallow a
  // rollback fault: rethrowing it would leave the row stuck queued-with-null
  // and re-mask the original dispatch error.
  private async rollbackClaim(id: number): Promise<void> {
    await this.model
      .update({
        where: { id },
        data: {
          status: RaceOpponentResearchStatus.failed,
          attempts: { decrement: 1 },
        },
      })
      .catch((err: unknown) => {
        this.logger.error(
          { err, id },
          'rollbackClaim failed; research row may remain queued',
        )
      })
  }

  // opponent_research input: opponent.full_name + race_context.office_name/state
  // are required. The candidate platform and opponent hints (incumbency,
  // website, socials) are optional context the agent can rediscover. A missing
  // race context degrades the optional race fields rather than blocking; the
  // scope (which categories to research) lives in the manifest, not params.
  private async buildParams(
    campaign: CampaignWith<'user'>,
    opponentName: string,
  ): Promise<OpponentResearchInput> {
    const details = CampaignDetailsSchema.safeParse(campaign.details)
    const city = details.success ? (details.data.city ?? null) : null
    const raceContext = await this.tryRaceContext(campaign)
    const rosterMatch = this.matchRosterCandidate(raceContext, opponentName)

    return fitPlatform({
      opponent: {
        full_name: opponentName,
        is_incumbent: rosterMatch?.isIncumbent ?? null,
        website_url: rosterMatch?.websiteUrl ?? null,
      },
      race_context: {
        city,
        election_date:
          raceContext?.generalElectionDate ??
          raceContext?.relevantElectionDate ??
          null,
        office_name:
          raceContext?.officialOfficeName ?? raceContext?.candidateOffice ?? '',
        state: raceContext?.state ?? '',
      },
      candidate_platform: await this.buildPlatform(campaign.id),
    })
  }

  private async buildPlatform(
    campaignId: number,
  ): Promise<OpponentResearchInput['candidate_platform']> {
    // Issues live on the website now (shared with Pro-upgrade), flattened to
    // the plain-text string candidate_platform.issues expects.
    const [story, website] = await Promise.all([
      this.client.campaignStory.findUnique({
        where: { campaignId },
        select: { why: true, background: true },
      }),
      this.client.website.findUnique({
        where: { campaignId },
        select: { content: true },
      }),
    ])
    const issues = serializeWebsiteIssues(website?.content?.about?.issues ?? [])
    if (!story && !issues) return null
    return {
      why: story?.why ?? null,
      background: story?.background ?? null,
      issues,
    }
  }

  private matchRosterCandidate(
    raceContext: RaceContextFromApi | null,
    opponentName: string,
  ) {
    if (!raceContext) return null
    const target = opponentName.trim().toLowerCase()
    return (
      raceContext.candidates.find(
        (c) => c.fullName.trim().toLowerCase() === target,
      ) ?? null
    )
  }

  private async tryRaceContext(
    campaign: CampaignWith<'user'>,
  ): Promise<RaceContextFromApi | null> {
    const details = CampaignDetailsSchema.safeParse(campaign.details)
    const raceId = details.success ? (details.data.raceId ?? '').trim() : ''
    if (raceId.length === 0) return null
    try {
      return await this.electionApi.getRaceContext(raceId)
    } catch {
      this.logger.warn(
        { campaignId: campaign.id, raceId },
        'race context unavailable for opponent research',
      )
      return null
    }
  }

  private toResearch(row: RaceOpponentResearchRow): RaceOpponentResearch {
    return {
      id: row.id,
      kind: row.kind,
      opponentName: row.opponentName,
      electionCandidacyId: row.electionCandidacyId,
      status: row.status,
      runId: row.runId,
      attempts: row.attempts,
      completedAt: row.completedAt,
      lastViewedAt: row.lastViewedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }
  }

  private toFinding(row: RaceOpponentFindingRow) {
    return {
      id: row.id,
      researchId: row.researchId,
      claim: row.claim,
      sourceUrl: row.sourceUrl,
      sourceExtract: row.sourceExtract,
      sourceTitle: row.sourceTitle,
      sourceReachableAt: row.sourceReachableAt,
      category: row.category,
      occurredAt: row.occurredAt,
      draftedResponse: row.draftedResponse,
      createdAt: row.createdAt,
    }
  }
}
