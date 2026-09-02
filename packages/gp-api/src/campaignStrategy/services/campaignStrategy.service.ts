import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common'
import {
  Campaign,
  CampaignStrategy,
  ExperimentRun,
  ExperimentRunStatus,
} from '../../generated/prisma'
import { isBefore, subMinutes } from 'date-fns'
import { z } from 'zod'
import { CampaignWith } from '@/campaigns/campaigns.types'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { isUniqueConstraintError } from 'src/prisma/util/prismaErrors.util'
import { ExperimentRunsService } from '@/agentExperiments/services/experimentRuns.service'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { AgentJobContracts } from '@/generated/agent-job-contracts'
import {
  parseOpponents,
  parseOpportunitiesAndChallenges,
  StrategicLandscapeResponse,
  StrategicLandscapeResult,
} from '../schemas/strategicLandscape.schema'
import { ElectionApiRaceNotFoundError } from './electionApi.service'
import { StrategicLandscapeParamsService } from './strategicLandscapeParams.service'
import { StrategicLandscapePersister } from './strategicLandscape.persister'
import { AnalyticsService } from '@/analytics/analytics.service'
import { EVENTS } from '@/vendors/segment/segment.types'
import { CampaignTrackerTasksService } from '@/campaigns/campaignTracker/services/campaignTrackerTasks.service'
import { isTestCampaign } from '@/users/util/users.util'

const OPPOSITION = 'opposition_research'
const OPPORTUNITIES = 'opportunities_and_challenges'

const EMPTY_STRATEGIC_LANDSCAPE: StrategicLandscapeResult = {
  opportunities: [],
  challenges: [],
  opponents: [],
}

// A run that's COMPLETED but whose section never persisted past this window is
// treated as stuck and re-dispatched on the next call (the persist step
// silently dropped it, e.g. a double DB fault). Within the window it still
// reads as in-flight so a poll between a run being marked COMPLETED and its
// rows landing can't trigger a spurious re-dispatch.
const PERSIST_GRACE_MINUTES = 5

// Max dispatches per section over a plan's lifetime. A failed or stuck section
// is re-dispatched when the endpoint is called again, so a user who hit a
// transient error can just retry. The cap stops a deterministic failure — or a
// client/attacker hammering the endpoint — from spawning unbounded Fargate
// runs. Enforced with an atomic conditional increment, so even a concurrent
// burst can claim at most this many slots. Deliberately NOT reset on a race
// change (it bounds lifetime spend per campaign, not per race), so the cap is
// sized to leave headroom for a few office changes.
const MAX_SECTION_ATTEMPTS = 10

// Per-section disposition that drives the endpoint status. 'redispatch' is the
// only state that starts a new run; the others are read off existing state.
// 'dead' = attempt cap reached (terminal failed). 'stalled' = a dispatch was
// attempted this call but its SQS send failed (the next call retries).
type SectionState = 'persisted' | 'inflight' | 'redispatch' | 'dead' | 'stalled'

// Both CAP experiments share one input contract.
type StrategicLandscapeParams =
  AgentJobContracts['opposition_research']['Input']

type DispatchBase = {
  organizationSlug: string
  clerkUserId: string
  params: StrategicLandscapeParams
}

// Defensive Zod parse over Campaign.details — the column is Prisma JSON,
// so we can't trust the shadow type at runtime. Only the keys we read here
// are declared; everything else passes through silently. raceId is the
// BallotReady race hash that election-api keys on.
//
// Every field is independently fault-tolerant (`.catch(null)`): a single
// off-shape value anywhere in details must never fail the whole parse,
// because a failed parse makes raceId look empty even when it's a
// perfectly valid string — surfacing as a bogus "no raceId" 400 on both
// strategy endpoints. That bit us twice: first with explicit `null`
// values (hence `.nullable()` everywhere), then with
// `officeTermLength: "4 years"` — the campaign-details editor writes a
// string per the PrismaJson.CampaignDetails contract, while this schema
// wrongly said number.
const lenientString = z.string().nullable().optional().catch(null)
const CampaignDetailsSchema = z
  .object({
    party: lenientString,
    otherParty: lenientString,
    raceId: lenientString,
    zip: lenientString,
    city: lenientString,
    state: lenientString,
    electionDate: lenientString,
    officeTermLength: lenientString,
  })
  .partial()

const resolveRaceId = (details: Campaign['details']): string => {
  const parsed = CampaignDetailsSchema.safeParse(details)
  const raceId = parsed.success ? (parsed.data.raceId ?? '').trim() : ''
  if (raceId.length === 0) {
    throw new BadRequestException(
      'Campaign has no raceId — finish onboarding before generating a strategy.',
    )
  }
  return raceId
}

@Injectable()
export class CampaignStrategyService extends createPrismaBase(
  MODELS.CampaignStrategy,
) {
  constructor(
    private readonly params: StrategicLandscapeParamsService,
    private readonly experimentRuns: ExperimentRunsService,
    private readonly persister: StrategicLandscapePersister,
    private readonly s3: S3Service,
    private readonly analytics: AnalyticsService,
    private readonly campaignTrackerTasks: CampaignTrackerTasksService,
  ) {
    super()
  }

  private async resolveCampaignUserId(
    campaignId: number,
  ): Promise<number | null> {
    const campaign = await this.client.campaign.findUnique({
      where: { id: campaignId },
      select: { userId: true },
    })
    return campaign?.userId ?? null
  }

  async existsForCampaign(campaignId: number): Promise<boolean> {
    return (await this.model.count({ where: { campaignId } })) > 0
  }

  async getOrGenerateStrategicLandscape(
    campaign: CampaignWith<'user'>,
  ): Promise<StrategicLandscapeResponse> {
    if (!campaign.user) {
      throw new InternalServerErrorException(
        'Campaign has no associated user — check @UseCampaign include',
      )
    }

    if (isTestCampaign(campaign)) {
      return { status: 'ready', data: EMPTY_STRATEGIC_LANDSCAPE }
    }

    // Materialize the tracker's static rows now, at generation start, so they
    // render immediately while the dynamic tasks generate in the background
    // (the initial CAP dispatch still fires from the plan-completion bootstrap).
    // Story-gated to the tracker cohort, best-effort, and idempotent.
    await this.ensureTrackerStaticTasks(campaign)

    // Resolve raceId synchronously so a 400 surfaces to this call rather than
    // a dispatch with no race.
    const brHashId = resolveRaceId(campaign.details)
    const plan = await this.alignPlanWithRace(
      await this.upsertForCampaign(campaign.id, brHashId),
      brHashId,
    )

    const [opposition, opportunities] = await Promise.all([
      this.runFor(plan.oppositionRunId),
      this.runFor(plan.opportunitiesRunId),
    ])

    // Ready only once BOTH sections are persisted (markers set in the same tx
    // as the rows). Gating on run status instead would race: a run can be
    // COMPLETED a beat before its rows land, yielding a hollow 'ready'.
    if (plan.oppositionPersistedAt && plan.opportunitiesPersistedAt) {
      return {
        status: 'ready',
        data: await this.readStrategicLandscape(plan.id),
      }
    }

    // A failed or stuck section is re-dispatched (subject to the attempt cap),
    // not reported terminally — so a transient error is recoverable by calling
    // the endpoint again.
    return this.dispatchPending(campaign, plan, brHashId, {
      opposition: this.sectionState(opposition, plan.oppositionPersistedAt),
      opportunities: this.sectionState(
        opportunities,
        plan.opportunitiesPersistedAt,
      ),
    })
  }

  // Dispatch port for the race-opponent flow: ensure opposition_research has
  // run (or is running) for this campaign so opponent NAMES get discovered —
  // without also dispatching the paid opportunities_and_challenges section that
  // getOrGenerateStrategicLandscape would. Reuses the plan's own dedup +
  // attempt-cap machinery (upsert/align, sectionState, attemptOpposition), so
  // discovery lives in exactly one place and the two paths can't drift.
  //
  // Degrades to 'unavailable' (logged, never thrown) when there's no race,
  // election-api is down, or the attempt cap / SQS send fails, so the
  // race-opponent collect path never 500s on a setup gap.
  async ensureOppositionResearch(campaign: CampaignWith<'user'>): Promise<{
    disposition: 'inflight' | 'persisted' | 'unavailable'
    oppositionRunId: string | null
  }> {
    const clerkUserId = campaign.user?.clerkId
    if (!clerkUserId)
      return { disposition: 'unavailable', oppositionRunId: null }

    const parsed = CampaignDetailsSchema.safeParse(campaign.details)
    const brHashId = parsed.success ? (parsed.data.raceId ?? '').trim() : ''
    if (brHashId.length === 0) {
      return { disposition: 'unavailable', oppositionRunId: null }
    }

    const plan = await this.alignPlanWithRace(
      await this.upsertForCampaign(campaign.id, brHashId),
      brHashId,
    )

    const [opposition, opportunities] = await Promise.all([
      this.runFor(plan.oppositionRunId),
      this.runFor(plan.opportunitiesRunId),
    ])
    const state = this.sectionState(opposition, plan.oppositionPersistedAt)
    if (state === 'persisted') {
      return { disposition: 'persisted', oppositionRunId: plan.oppositionRunId }
    }
    if (state === 'inflight') {
      return { disposition: 'inflight', oppositionRunId: plan.oppositionRunId }
    }

    // 'redispatch': build params (election-api) then claim+dispatch opposition.
    let params: StrategicLandscapeParams
    try {
      params = await this.params.build(campaign, brHashId)
    } catch (error) {
      if (
        error instanceof ElectionApiRaceNotFoundError ||
        error instanceof BadGatewayException
      ) {
        this.logger.warn(
          { error, campaignId: campaign.id, raceId: brHashId },
          'election-api unavailable while discovering opponents; reporting unavailable',
        )
        return { disposition: 'unavailable', oppositionRunId: null }
      }
      throw error
    }

    const freshStart =
      this.sectionState(opportunities, plan.opportunitiesPersistedAt) !==
      'inflight'
    const result = await this.attemptOpposition(
      campaign.userId,
      plan,
      { organizationSlug: campaign.organizationSlug, clerkUserId, params },
      freshStart,
    )
    if (result !== 'inflight') {
      // 'dead' = opposition attempt cap reached (often burned by prior
      // plan-endpoint retries; counters survive race changes). 'stalled' = the
      // SQS dispatch failed this call. Log so the otherwise-silent 'unavailable'
      // (which the race-opponent page renders as an empty state) is diagnosable.
      this.logger.warn(
        {
          campaignId: campaign.id,
          raceId: brHashId,
          result,
          oppositionAttempts: plan.oppositionAttempts,
        },
        result === 'dead'
          ? 'opposition attempt cap reached while discovering opponents; reporting unavailable'
          : 'opposition dispatch stalled (SQS) while discovering opponents; reporting unavailable',
      )
      return { disposition: 'unavailable', oppositionRunId: null }
    }
    // attemptOpposition swallows a transient fault on the run-id link and still
    // returns 'inflight'. An unlinked run is orphaned: onExperimentRunCompleted
    // looks the plan up by oppositionRunId and finds nothing, so opponents never
    // persist. Report 'unavailable' so collect() settles to idle instead of
    // returning a 'discovering' the page can never advance past.
    const linked = await this.findFirst({ where: { id: plan.id } })
    if (!linked?.oppositionRunId) {
      return { disposition: 'unavailable', oppositionRunId: null }
    }
    return {
      disposition: 'inflight',
      oppositionRunId: linked.oppositionRunId,
    }
  }

  // Queue-consumer hook: when one of the two CAP runs completes, load its
  // artifact and persist that section. Each section persists independently;
  // the endpoint reports 'ready' once both sections are persisted.
  async onExperimentRunCompleted(run: ExperimentRun): Promise<void> {
    if (run.status !== ExperimentRunStatus.COMPLETED) return
    if (
      run.experimentType !== OPPOSITION &&
      run.experimentType !== OPPORTUNITIES
    ) {
      return
    }

    // A COMPLETED CAP run with no artifact can never be persisted. Treat it as
    // a failure so the endpoint reports 'failed' instead of sitting 'ready'.
    if (!run.artifactBucket || !run.artifactKey) {
      await this.experimentRuns.markFailed(
        run.runId,
        'completed run has no artifact location',
      )
      throw new Error(`run ${run.runId} completed without an artifact location`)
    }

    const plan = await this.findFirst({
      where:
        run.experimentType === OPPOSITION
          ? { oppositionRunId: run.runId }
          : { opportunitiesRunId: run.runId },
    })
    if (!plan) return

    // The race this run generated for, from its own dispatch params — NOT
    // the plan's current stamp, which can change (race reset, or a legacy
    // null row being adopted) between here and the persist. The persister
    // compares against this value at write time. Zod-parsed because the
    // params column is untyped Json at runtime.
    const parsedParams = z
      .object({ race_id: z.string().nullable().optional() })
      .safeParse(run.params)
    const runRace = parsedParams.success
      ? (parsedParams.data.race_id ?? null)
      : null

    const userId = await this.resolveCampaignUserId(plan.campaignId)

    // If loading, parsing, or persisting the artifact fails, the run was
    // marked COMPLETED upstream but its section never landed. Flip it to
    // FAILED so the endpoint reports 'failed' rather than a permanent
    // hollow 'ready'. Rethrow so the consumer logs it.
    try {
      const raw = await this.s3.getFile(run.artifactBucket, run.artifactKey)
      if (!raw) throw new Error('artifact is missing or empty')

      if (run.experimentType === OPPOSITION) {
        await this.persister.persistOpponents(
          plan.id,
          runRace,
          parseOpponents(raw),
        )
        if (userId !== null) {
          void this.analytics
            .track(
              userId,
              EVENTS.CampaignPlanV2.OppositionResearchGenerationCompleted,
              {
                campaignId: plan.campaignId,
                planId: plan.id,
                generationEngine: 'cap',
                runId: run.runId,
                durationSeconds: run.durationSeconds,
                costUsd: run.costUsd,
                outcome: run.status,
              },
            )
            .catch(() => undefined)
        }
      } else {
        const { opportunities, challenges } =
          parseOpportunitiesAndChallenges(raw)
        await this.persister.persistOpportunitiesAndChallenges(
          plan.id,
          runRace,
          opportunities,
          challenges,
        )
        if (userId !== null) {
          void this.analytics
            .track(
              userId,
              EVENTS.CampaignPlanV2.OpportunitiesChallengesGenerationCompleted,
              {
                campaignId: plan.campaignId,
                planId: plan.id,
                generationEngine: 'cap',
                runId: run.runId,
                durationSeconds: run.durationSeconds,
                costUsd: run.costUsd,
                outcome: run.status,
              },
            )
            .catch(() => undefined)
        }
      }
    } catch (error) {
      await this.experimentRuns.markFailed(
        run.runId,
        error instanceof Error ? error.message : String(error),
      )
      throw error
    }

    await this.bootstrapTrackerIfPlanComplete(plan.id, plan.campaignId)
  }

  // Materialize the tracker's static rows at plan-generation start so they
  // render immediately, rather than waiting for the plan-completion bootstrap
  // (which is CAP/SQS-driven and never fires locally). Story-gated to the
  // tracker cohort so legacy campaigns never get tracker rows, and best-effort
  // so a tracker hiccup can't fail plan generation. materializeStaticTasks is
  // idempotent and race-safe, so calling it on every poll is cheap and the
  // initial dynamic dispatch still happens once, from the bootstrap below.
  private async ensureTrackerStaticTasks(
    campaign: CampaignWith<'user'>,
  ): Promise<void> {
    const story = await this.client.campaignStory.findUnique({
      where: { campaignId: campaign.id },
      select: { id: true },
    })
    if (!story) return

    await this.campaignTrackerTasks
      .materializeStaticTasks(campaign)
      .catch((err: unknown) =>
        this.logger.error(
          { err, campaignId: campaign.id },
          'tracker static-task materialization failed at plan start',
        ),
      )
  }

  // The plan is fully generated once both sections are persisted — that is the
  // trigger to bootstrap the campaign tracker (static rows + the initial CAP
  // generation). Fail-closed: a tracker hiccup must not throw back into the
  // result handler, or the SQS result would replay and re-persist the section.
  private async bootstrapTrackerIfPlanComplete(
    planId: number,
    campaignId: number,
  ): Promise<void> {
    const plan = await this.findFirst({ where: { id: planId } })
    if (!plan?.oppositionPersistedAt || !plan.opportunitiesPersistedAt) return

    // The tracker uses the campaign story as input, so it only exists once the
    // campaign has gone through campaign story. Legacy (campaign-story off)
    // campaigns never write a story, so they stay on the legacy task path and
    // never bootstrap the tracker even though their plan still generates. This
    // gate is on story data (not the flag) so it holds regardless of the flag.
    const story = await this.client.campaignStory.findUnique({
      where: { campaignId },
    })
    if (!story) return

    const campaign = await this.client.campaign.findUnique({
      where: { id: campaignId },
      include: { user: true },
    })
    if (!campaign) return

    await this.campaignTrackerTasks
      .bootstrapForCampaign(campaign)
      .catch((err: unknown) =>
        this.logger.error(
          { err, campaignId },
          'campaign tracker bootstrap failed after plan completion',
        ),
      )
  }

  private runFor(runId: string | null): Promise<ExperimentRun | null> {
    if (!runId) return Promise.resolve(null)
    return this.experimentRuns.findUnique({ where: { runId } })
  }

  // Classifies a section from its run + persistence marker. Only 'redispatch'
  // starts a new run (see SectionState).
  private sectionState(
    run: ExperimentRun | null,
    persistedAt: Date | null,
  ): SectionState {
    if (persistedAt) return 'persisted'
    // QUEUED (waiting to launch), RUNNING, AWAITING_RESUME (paused mid-run), and
    // SUPERSEDED (the resume sweep already dispatched a live successor) are all
    // in flight — none should be re-dispatched. Re-dispatching here would
    // overwrite oppositionRunId, orphan the paused/successor run, and let a
    // second concurrent task spawn against the same campaign.
    if (
      run?.status === ExperimentRunStatus.QUEUED ||
      run?.status === ExperimentRunStatus.RUNNING ||
      run?.status === ExperimentRunStatus.AWAITING_RESUME ||
      run?.status === ExperimentRunStatus.SUPERSEDED
    ) {
      return 'inflight'
    }
    // COMPLETED but unpersisted: in-flight until the grace window (waiting for
    // its rows to land), then treated as stuck and re-dispatched.
    if (
      run?.status === ExperimentRunStatus.COMPLETED &&
      !isBefore(run.updatedAt, subMinutes(new Date(), PERSIST_GRACE_MINUTES))
    ) {
      return 'inflight'
    }
    // null, FAILED, or stuck-COMPLETED -> (re)dispatch.
    return 'redispatch'
  }

  // Dispatches the sections that need it (subject to the attempt cap) and
  // resolves the endpoint status. 'ready' is handled by the caller; this only
  // returns 'generating' or 'failed'.
  private async dispatchPending(
    campaign: CampaignWith<'user'>,
    plan: CampaignStrategy,
    brHashId: string,
    states: { opposition: SectionState; opportunities: SectionState },
  ): Promise<StrategicLandscapeResponse> {
    const dispatchOpposition = states.opposition === 'redispatch'
    const dispatchOpportunities = states.opportunities === 'redispatch'
    if (!dispatchOpposition && !dispatchOpportunities) {
      return this.statusFrom(states.opposition, states.opportunities)
    }

    const clerkUserId = campaign.user?.clerkId
    if (!clerkUserId) {
      throw new BadRequestException(
        'User must be signed in to generate a strategy.',
      )
    }

    // Building params calls election-api. If the race isn't found (404) or
    // election-api is otherwise unavailable, there's nothing to dispatch —
    // report a terminal 'failed' so the client stops polling instead of
    // re-hammering election-api with a 500/502 on every poll.
    let params: StrategicLandscapeParams
    try {
      params = await this.params.build(campaign, brHashId)
    } catch (error) {
      if (
        error instanceof ElectionApiRaceNotFoundError ||
        error instanceof BadGatewayException
      ) {
        this.logger.warn(
          { error, campaignId: campaign.id, raceId: brHashId },
          'election-api unavailable while building strategy params; reporting failed',
        )
        return { status: 'failed' }
      }
      throw error
    }
    const base = {
      organizationSlug: campaign.organizationSlug,
      clerkUserId,
      params,
    }

    // Stamp generationStartedAt only when kicking off work on an otherwise-idle
    // plan (nothing already in flight). A dispatch that joins an in-flight
    // generation keeps the original start, so trigger->ready duration is the
    // later persistedAt minus this. A retry of a failed/stuck section resets it.
    const freshStart =
      states.opposition !== 'inflight' && states.opportunities !== 'inflight'

    const opposition = dispatchOpposition
      ? await this.attemptOpposition(campaign.userId, plan, base, freshStart)
      : states.opposition
    const opportunities = dispatchOpportunities
      ? await this.attemptOpportunities(campaign.userId, plan, base, freshStart)
      : states.opportunities

    return this.statusFrom(opposition, opportunities)
  }

  // Claim a lifetime attempt slot for the opposition section, then dispatch.
  // The conditional increment is atomic, so a concurrent burst can claim at
  // most MAX_SECTION_ATTEMPTS slots in total — bounding the Fargate runs a
  // failing-and-retried (or maliciously hammered) section can spawn.
  private async attemptOpposition(
    userId: number,
    plan: CampaignStrategy,
    base: DispatchBase,
    freshStart: boolean,
  ): Promise<SectionState> {
    const claimed = await this.client.campaignStrategy.updateMany({
      where: { id: plan.id, oppositionAttempts: { lt: MAX_SECTION_ATTEMPTS } },
      data: { oppositionAttempts: { increment: 1 } },
    })
    if (claimed.count === 0) return 'dead'

    const runId = await this.tryDispatch(OPPOSITION, base)
    if (!runId) return 'stalled'

    if (freshStart) {
      void this.analytics
        .track(
          userId,
          EVENTS.CampaignPlanV2.OppositionResearchGenerationStarted,
          {
            campaignId: plan.campaignId,
            planId: plan.id,
            generationEngine: 'cap',
            runId,
            attempt: plan.oppositionAttempts + 1,
          },
        )
        .catch(() => undefined)
    }

    try {
      await this.client.campaignStrategy.update({
        where: { id: plan.id },
        data: {
          oppositionRunId: runId,
          ...(freshStart ? { generationStartedAt: new Date() } : {}),
        },
      })
    } catch (error) {
      // A transient DB fault linking the run must not 500 the call: the run is
      // dispatched and RUNNING, the unlinked row is reclaimed by the stale
      // sweep, and the next call re-dispatches (a slot was already consumed).
      this.logger.error(
        { error, planId: plan.id, runId },
        'Failed to link oppositionRunId to plan',
      )
    }
    return 'inflight'
  }

  private async attemptOpportunities(
    userId: number,
    plan: CampaignStrategy,
    base: DispatchBase,
    freshStart: boolean,
  ): Promise<SectionState> {
    const claimed = await this.client.campaignStrategy.updateMany({
      where: {
        id: plan.id,
        opportunitiesAttempts: { lt: MAX_SECTION_ATTEMPTS },
      },
      data: { opportunitiesAttempts: { increment: 1 } },
    })
    if (claimed.count === 0) return 'dead'

    const runId = await this.tryDispatch(OPPORTUNITIES, base)
    if (!runId) return 'stalled'

    if (freshStart) {
      void this.analytics
        .track(
          userId,
          EVENTS.CampaignPlanV2.OpportunitiesChallengesGenerationStarted,
          {
            campaignId: plan.campaignId,
            planId: plan.id,
            generationEngine: 'cap',
            runId,
            attempt: plan.opportunitiesAttempts + 1,
          },
        )
        .catch(() => undefined)
    }

    try {
      await this.client.campaignStrategy.update({
        where: { id: plan.id },
        data: {
          opportunitiesRunId: runId,
          ...(freshStart ? { generationStartedAt: new Date() } : {}),
        },
      })
    } catch (error) {
      // See attemptOpposition: don't 500 on a transient link failure.
      this.logger.error(
        { error, planId: plan.id, runId },
        'Failed to link opportunitiesRunId to plan',
      )
    }
    return 'inflight'
  }

  // Map the two post-dispatch section states to an endpoint status. A 'dead'
  // section (cap reached) means the plan can never complete, so it wins ->
  // failed. A 'stalled' section (SQS send failed this call) also reports
  // failed but is retryable next call; 'inflight' wins while nothing is dead.
  private statusFrom(
    opposition: SectionState,
    opportunities: SectionState,
  ): StrategicLandscapeResponse {
    if (opposition === 'dead' || opportunities === 'dead') {
      return { status: 'failed' }
    }
    if (opposition === 'inflight' || opportunities === 'inflight') {
      return { status: 'generating' }
    }
    return { status: 'failed' }
  }

  // A dispatch failure (no queue, or an SQS send error -> BadGateway) yields no
  // runId. Swallow it so the call reports 'stalled'/'failed' instead of a 502.
  // The FAILED row dispatchRun left behind stays unlinked: it's a monitoring
  // breadcrumb of the SQS failure, the RUNNING-only stale sweep ignores it, and
  // the section re-dispatches on the next call (a slot was already spent, so
  // it's bounded by MAX_SECTION_ATTEMPTS). We don't touch dispatchRun's throw
  // contract here because it's shared (meetings/TCR/admin).
  private async tryDispatch(
    type: typeof OPPOSITION | typeof OPPORTUNITIES,
    base: DispatchBase,
  ): Promise<string | undefined> {
    try {
      const run = await this.experimentRuns.dispatchRun({ type, ...base })
      return run?.runId
    } catch {
      return undefined
    }
  }

  private async upsertForCampaign(
    campaignId: number,
    raceId: string,
  ): Promise<CampaignStrategy> {
    // Prisma's `upsert` is not transactional in Postgres — it issues a
    // SELECT followed by an INSERT-or-UPDATE. Two requests landing in the
    // same race window (e.g. the two pre-warm POSTs fired back-to-back
    // from OnboardingFlow) both see "no row", both try INSERT, and the
    // second trips the @@unique([campaign_id]) constraint with P2002.
    // The PrismaExceptionFilter then surfaces that as a 409 to the
    // client. The row exists by the time we see P2002, so re-fetch it.
    try {
      return await this.client.campaignStrategy.upsert({
        where: { campaignId },
        create: { campaignId, raceId },
        update: {},
      })
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error
      return this.client.campaignStrategy.findUniqueOrThrow({
        where: { campaignId },
      })
    }
  }

  // Brings a plan row in line with the campaign's current race before any
  // cached content is served. Three cases:
  //   match    → no-op.
  //   null     → legacy row from before the stamp existed; adopt the current
  //              race without resetting (the backfill blessed its content).
  //   mismatch → the office changed since generation. Every cached artifact
  //              (CAP runs, persisted sections) belongs to the previous
  //              race, so wipe content in place and let the
  //              caller regenerate. The row itself survives so the dashboard
  //              gate (hasCampaignStrategy / the exists endpoint) stays open
  //              and the user sees skeletons instead of a vanished plan.
  //              Attempt counters deliberately survive — they bound lifetime
  //              Fargate spend per campaign, not per race. Clearing the run
  //              ids orphans any in-flight run for the old race:
  //              onExperimentRunCompleted looks the plan up by run id and
  //              finds nothing.
  private async alignPlanWithRace(
    plan: CampaignStrategy,
    raceId: string,
  ): Promise<CampaignStrategy> {
    if (plan.raceId === raceId) return plan

    if (plan.raceId === null) {
      return this.model.update({
        where: { id: plan.id },
        data: { raceId },
      })
    }
    const previousRaceId = plan.raceId

    // The claim goes FIRST: when it matches, it takes the plan row's lock
    // before touching children, and a persist transaction claims the same
    // row as its first statement, so winners serialize. When it matches
    // zero rows no lock is taken — correctness there rests on the
    // optimistic check itself: the loser does nothing and re-reads the
    // winner's result. Without the guard, two concurrent requests that
    // both read the old race would each `push` it, appending the same old
    // race twice and doubling the analytics count.
    const won = await this.client.$transaction(async (tx) => {
      const { count } = await tx.campaignStrategy.updateMany({
        where: { id: plan.id, raceId: previousRaceId },
        data: {
          raceId,
          previousRaceIds: { push: previousRaceId },
          oppositionRunId: null,
          opportunitiesRunId: null,
          oppositionPersistedAt: null,
          opportunitiesPersistedAt: null,
          generationStartedAt: null,
        },
      })
      if (count === 0) return false
      await tx.campaignStrategyOpportunity.deleteMany({
        where: { campaignStrategyId: plan.id },
      })
      await tx.campaignStrategyChallenge.deleteMany({
        where: { campaignStrategyId: plan.id },
      })
      await tx.campaignStrategyOpponent.deleteMany({
        where: { campaignStrategyId: plan.id },
      })
      return true
    })

    const updated = await this.model.findUniqueOrThrow({
      where: { id: plan.id },
    })
    if (!won) return updated

    const userId = await this.resolveCampaignUserId(plan.campaignId)
    if (userId !== null) {
      void this.analytics
        .track(userId, EVENTS.CampaignPlanV2.StrategyRaceChanged, {
          campaignId: plan.campaignId,
          planId: plan.id,
          previousRaceId,
          newRaceId: raceId,
          raceChangeCount: updated.previousRaceIds.length,
        })
        .catch(() => undefined)
    }

    return updated
  }

  // Pure read for consumers that must NEVER trigger (paid) generation or the
  // align/reset machinery — today the Campaign Manager chat, which grounds its
  // system prompt in the plan. Returns null until BOTH sections are persisted
  // (the same gate the polling endpoint uses for 'ready'), so a partial plan
  // is never surfaced. May serve content from before an office change; the
  // plan tab's getOrGenerateStrategicLandscape remains the canonical fresh
  // read.
  async readLandscapeForCampaign(
    campaignId: number,
  ): Promise<StrategicLandscapeResult | null> {
    const plan = await this.client.campaignStrategy.findUnique({
      where: { campaignId },
      include: {
        opportunities: { orderBy: { order: 'asc' } },
        challenges: { orderBy: { order: 'asc' } },
        opponents: true,
      },
    })
    if (!plan?.oppositionPersistedAt || !plan.opportunitiesPersistedAt) {
      return null
    }
    return {
      opportunities: plan.opportunities.map((o) => o.content),
      challenges: plan.challenges.map((c) => c.content),
      opponents: plan.opponents.map((o) => ({
        fullName: o.fullName,
        partyAffiliation: o.partyAffiliation,
        incumbent: o.incumbent,
      })),
    }
  }

  private async readStrategicLandscape(
    campaignStrategyId: number,
  ): Promise<StrategicLandscapeResult> {
    const plan = await this.client.campaignStrategy.findUnique({
      where: { id: campaignStrategyId },
      include: {
        opportunities: { orderBy: { order: 'asc' } },
        challenges: { orderBy: { order: 'asc' } },
        opponents: true,
      },
    })
    // The row was just upserted in this request; a null here is a real
    // data-integrity problem, not "empty data" to paper over.
    if (!plan) {
      throw new InternalServerErrorException(
        `CampaignStrategy ${campaignStrategyId} not found when reading sections`,
      )
    }
    return {
      opportunities: plan.opportunities.map((o) => o.content),
      challenges: plan.challenges.map((c) => c.content),
      opponents: plan.opponents.map((o) => ({
        fullName: o.fullName,
        partyAffiliation: o.partyAffiliation,
        incumbent: o.incumbent,
      })),
    }
  }
}
