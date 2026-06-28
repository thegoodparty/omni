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
import { RaceOpponentService } from './raceOpponent.service'
import { SelfResearchGateService } from './selfResearchGate.service'
import {
  MAX_OPPONENT_RESEARCH_ATTEMPTS,
  OPPONENT_RESEARCH,
} from '../raceOpponent.constants'

type OpponentResearchInput = AgentJobContracts['opponent_research']['Input']

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

    const params = await this.buildParams(campaign, opponentName)

    // Claim the row BEFORE the external dispatch (DB-claim-before-external-call):
    // queued with runId still null and attempts incremented. If dispatch then
    // fails, the claim is rolled back to failed (scoped to this exact row) so the
    // user can retry — no ExperimentRun/SQS orphan with no research row to
    // receive its result.
    let claimed: RaceOpponentResearchRow
    if (existing) {
      claimed = await this.model.update({
        where: { id: existing.id },
        data: {
          status: RaceOpponentResearchStatus.queued,
          runId: null,
          attempts: { increment: 1 },
          completedAt: null,
          electionCandidacyId: request.electionCandidacyId ?? null,
        },
      })
    } else {
      try {
        claimed = await this.model.create({
          data: {
            campaignId: campaign.id,
            kind: RaceOpponentFindingKind.opponent,
            opponentName,
            electionCandidacyId: request.electionCandidacyId ?? null,
            status: RaceOpponentResearchStatus.queued,
            attempts: 1,
          },
        })
      } catch (error) {
        // Concurrent POST won the (campaignId, opponent, opponentName) claim.
        // The loser trips P2002 here — return the winner's in-flight row
        // instead of dispatching a duplicate run.
        if (isUniqueConstraintError(error)) {
          const winner = await this.opponentRow(campaign.id, opponentName)
          if (winner) {
            return { research: this.toResearch(winner) }
          }
        }
        throw error
      }
    }

    let run: Awaited<ReturnType<typeof this.experimentRuns.dispatchRun>>
    try {
      run = await this.experimentRuns.dispatchRun({
        type: OPPONENT_RESEARCH,
        organizationSlug: campaign.organizationSlug,
        clerkUserId,
        params,
      })
    } catch (error) {
      await this.rollbackClaim(claimed.id)
      throw error
    }

    if (!run) {
      await this.rollbackClaim(claimed.id)
      throw new BadRequestException(
        'Opponent research is not available in this environment.',
      )
    }

    // Bind the dispatched run to the claimed row so onExperimentRunCompleted's
    // by-runId lookup resolves. Runs before any callback can arrive (QUEUED on
    // SQS). If the bind throws, roll the row to failed so the user can
    // re-trigger — the row is never left queued-with-null-runId.
    let bound: RaceOpponentResearchRow
    try {
      bound = await this.model.update({
        where: { id: claimed.id },
        data: { runId: run.runId },
      })
    } catch (error) {
      await this.rollbackClaim(claimed.id)
      throw error
    }

    return { research: this.toResearch(bound) }
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

    return {
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
    }
  }

  private async buildPlatform(
    campaignId: number,
  ): Promise<OpponentResearchInput['candidate_platform']> {
    const story = await this.client.campaignStory.findUnique({
      where: { campaignId },
      select: { why: true, background: true, issues: true },
    })
    if (!story) return null
    return {
      why: story.why ?? null,
      background: story.background ?? null,
      issues: story.issues ?? null,
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
