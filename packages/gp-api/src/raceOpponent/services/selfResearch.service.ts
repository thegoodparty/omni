import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common'
import { z } from 'zod'
import {
  RaceOpponentResearch,
  RaceOpponentResearchStatusResponse,
  RaceOpponentReportResponse,
  StartSelfResearchResponse,
} from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import {
  Prisma,
  RaceOpponentFindingKind,
  RaceOpponentResearchStatus,
  RaceOpponentResearch as RaceOpponentResearchRow,
  RaceOpponentFinding as RaceOpponentFindingRow,
} from '@/generated/prisma'
import { CampaignWith } from '@/campaigns/campaigns.types'
import { FeaturesService } from '@/features/services/features.service'
import { ExperimentRunsService } from '@/agentExperiments/services/experimentRuns.service'
import { AgentJobContracts } from '@/generated/agent-job-contracts'
import { ElectionApiService } from '@/campaignStrategy/services/electionApi.service'
import { getUserFullName } from '@/users/util/users.util'
import {
  KNOW_YOUR_OPPONENT_FEATURE,
  MAX_SELF_RESEARCH_ATTEMPTS,
  SELF_RESEARCH,
} from '../raceOpponent.constants'

type SelfResearchInput = AgentJobContracts['self_research']['Input']

// Only the campaign-details keys this module reads; the column is untyped JSON
// at runtime, so each leaf is independently fault-tolerant.
const lenientString = z.string().nullable().optional().catch(null)
const CampaignDetailsSchema = z
  .object({
    raceId: lenientString,
    city: lenientString,
    website: lenientString,
    normalizedOffice: lenientString,
    occupation: lenientString,
    pastExperience: z.string().nullable().optional().catch(null),
  })
  .partial()

@Injectable()
export class SelfResearchService extends createPrismaBase(
  MODELS.RaceOpponentResearch,
) {
  constructor(
    private readonly features: FeaturesService,
    private readonly experimentRuns: ExperimentRunsService,
    private readonly electionApi: ElectionApiService,
  ) {
    super()
  }

  // The ownership guard (@UseCampaign) already scopes the campaign to the
  // current user, so reaching here means the caller owns it. Pro + flag are the
  // remaining gates; both 4xx so the webapp can branch cleanly.
  private async assertAccess(campaign: CampaignWith<'user'>): Promise<void> {
    if (!campaign.isPro) {
      throw new ForbiddenException('Self-research requires Pro.')
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

  // The self pass per campaign. opponentName is null for kind=self, so the
  // @@unique([campaignId, kind, opponentName]) doesn't enforce a single row
  // (Postgres treats nulls as distinct); findFirst on (campaignId, kind=self)
  // is the lookup, and the orchestration below keeps it single via a claim.
  private selfRow(campaignId: number) {
    return this.model.findFirst({
      where: { campaignId, kind: RaceOpponentFindingKind.self },
    })
  }

  async start(
    campaign: CampaignWith<'user'>,
  ): Promise<StartSelfResearchResponse> {
    await this.assertAccess(campaign)

    const clerkUserId = campaign.user?.clerkId
    if (!clerkUserId) {
      throw new BadRequestException(
        'User must be signed in to start self-research.',
      )
    }

    const existing = await this.selfRow(campaign.id)

    // Reuse an already-settled or in-flight pass rather than dispatching a
    // duplicate paid run. completed is included: re-running a finished pass is a
    // separate explicit path (out of scope here), and overwriting it would
    // destroy the result. A second POST simply returns what's there.
    if (
      existing &&
      (existing.status === RaceOpponentResearchStatus.queued ||
        existing.status === RaceOpponentResearchStatus.running ||
        existing.status === RaceOpponentResearchStatus.completed)
    ) {
      return { research: this.toResearch(existing) }
    }

    if (existing && existing.attempts >= MAX_SELF_RESEARCH_ATTEMPTS) {
      throw new BadRequestException(
        'Self-research has failed repeatedly. Please try again later.',
      )
    }

    const params = await this.buildParams(campaign)

    // Claim the row BEFORE the external dispatch (DB-claim-before-external-call):
    // queued with runId still null and attempts incremented. If dispatch then
    // fails, the claim is rolled back to failed (scoped to this exact row) so the
    // user can retry — no ExperimentRun/SQS orphan with no research row to
    // receive its result.
    const claimed = existing
      ? await this.model.update({
          where: { id: existing.id },
          data: {
            status: RaceOpponentResearchStatus.queued,
            runId: null,
            attempts: { increment: 1 },
            completedAt: null,
          },
        })
      : await this.model.create({
          data: {
            campaignId: campaign.id,
            kind: RaceOpponentFindingKind.self,
            status: RaceOpponentResearchStatus.queued,
            attempts: 1,
          },
        })

    let run: Awaited<ReturnType<typeof this.experimentRuns.dispatchRun>>
    try {
      run = await this.experimentRuns.dispatchRun({
        type: SELF_RESEARCH,
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
        'Self-research is not available in this environment.',
      )
    }

    // Bind the dispatched run to the claimed row so onExperimentRunCompleted's
    // by-runId lookup resolves. This runs before any callback can arrive (the
    // run is QUEUED on SQS and can't complete before we return).
    const bound = await this.model.update({
      where: { id: claimed.id },
      data: { runId: run.runId },
    })

    return { research: this.toResearch(bound) }
  }

  // Scope the rollback to the exact claimed row id so a concurrent retry's
  // active claim can't be cleared by this caller's late failure.
  private async rollbackClaim(id: number): Promise<void> {
    await this.model.update({
      where: { id },
      data: { status: RaceOpponentResearchStatus.failed },
    })
  }

  async status(
    campaign: CampaignWith<'user'>,
  ): Promise<RaceOpponentResearchStatusResponse> {
    await this.assertAccess(campaign)

    const row = await this.selfRow(campaign.id)

    return {
      status: row?.status ?? RaceOpponentResearchStatus.not_started,
      research: row ? this.toResearch(row) : null,
    }
  }

  async report(
    campaign: CampaignWith<'user'>,
  ): Promise<RaceOpponentReportResponse> {
    await this.assertAccess(campaign)

    const row = await this.model.findFirst({
      where: { campaignId: campaign.id, kind: RaceOpponentFindingKind.self },
      include: { findings: { orderBy: { createdAt: Prisma.SortOrder.asc } } },
    })

    if (!row) {
      throw new BadRequestException('No self-research pass found.')
    }

    return {
      research: {
        ...this.toResearch(row),
        findings: row.findings.map((f) => this.toFinding(f)),
      },
    }
  }

  // self_research input: full_name/office_name/state are required, the rest are
  // disambiguation/footprint hints the agent can rediscover. A missing race
  // context (no raceId, or election-api down) degrades the optional fields to
  // null/empty rather than blocking — the agent works from name + office alone.
  private async buildParams(
    campaign: CampaignWith<'user'>,
  ): Promise<SelfResearchInput> {
    const user = campaign.user
    if (!user) {
      throw new BadRequestException(
        'Campaign has no associated user — cannot build self-research params.',
      )
    }

    const details = CampaignDetailsSchema.safeParse(campaign.details)
    const data = details.success ? details.data : {}
    const city = data.city ?? null
    const websiteUrl = data.website ?? null
    const detailsOffice = data.normalizedOffice ?? null
    const priorRoles = [data.occupation, data.pastExperience].filter(
      (role): role is string => typeof role === 'string' && role.length > 0,
    )
    const raceId = (data.raceId ?? '').trim()

    const raceContext =
      raceId.length > 0 ? await this.tryRaceContext(campaign.id, raceId) : null

    return {
      full_name: getUserFullName(user),
      office_name:
        raceContext?.officialOfficeName ??
        raceContext?.candidateOffice ??
        detailsOffice ??
        '',
      state: raceContext?.state ?? '',
      city,
      prior_roles: priorRoles,
      website_url: websiteUrl,
    }
  }

  private async tryRaceContext(campaignId: number, raceId: string) {
    try {
      return await this.electionApi.getRaceContext(raceId)
    } catch {
      this.logger.warn(
        { campaignId, raceId },
        'race context unavailable; dispatching self-research with name-only hints',
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
