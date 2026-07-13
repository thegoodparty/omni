import { ExperimentRunsService } from '@/agentExperiments/services/experimentRuns.service'
import { AnalyticsService } from '@/analytics/analytics.service'
import { CronLockService } from '@/cron/services/cronLock.service'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { WrapperType } from '@/shared/types/utility.types'
import { EVENTS } from '@/vendors/segment/segment.types'
import { forwardRef, Inject, Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { differenceInCalendarDays } from 'date-fns'
import { ElectedOffice, ExperimentRunStatus } from '../../generated/prisma'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import {
  bucketForSlug,
  topIssuesBucketForDate,
} from '../communityIssueBucketing'

const EXPERIMENT_TYPES = ['top_community_issues', 'trending_issues'] as const

type CommunityIssueExperimentType = (typeof EXPERIMENT_TYPES)[number]

// Per-cron-tick cap: limits how many dispatches can fire in a single run of
// the daily cron (both trending and top share this constant).
const DISPATCH_CAP_PER_TICK = 200

const isAutomationEnabled = () =>
  process.env.MEETINGS_AUTOMATION_ENABLED === 'true'

const TRENDING_CRON_JOB = 'trending_issues'
const TOP_CRON_JOB = 'top_community_issues'

// Don't spend generation budget on a user who hasn't opened the product in
// this many days — fire a re-engagement signal instead. The on-demand
// landing-catch-up path skips this gate, since landing already proves
// activity. Independent constant from meetingBriefings.service's — see "Why
// fully WET" in the design: the two domains intentionally don't share code.
const INACTIVITY_THRESHOLD_DAYS = 90

const isInactiveUser = (lastVisitedMs: number | undefined): boolean =>
  !lastVisitedMs ||
  differenceInCalendarDays(new Date(), new Date(lastVisitedMs)) >
    INACTIVITY_THRESHOLD_DAYS

type DispatchSummary = { dispatched: number; skipped: number }

type ResolvedDispatchContext = {
  userId: number
  clerkUserId: string
  state: string
  positionName: string
  districtDescriptor: string
  l2DistrictType?: string
  l2DistrictName?: string
  isServeIcp?: boolean | null
  lastVisitedMs?: number
}

// Builds the agent params for one (org, type) dispatch. The L2 district key is
// only included for top_community_issues — trending_issues' manifest is
// additionalProperties:false, so passing l2_* there fails the runtime
// input-schema check. Shared across all dispatch paths so they can't diverge.
const buildDispatchParams = (
  organizationSlug: string,
  experimentType: CommunityIssueExperimentType,
  ctx: ResolvedDispatchContext,
) => {
  const base = {
    organization_slug: organizationSlug,
    state: ctx.state,
    office: ctx.positionName,
    district_descriptor: ctx.districtDescriptor,
  }
  return experimentType === 'top_community_issues'
    ? {
        ...base,
        l2_district_type: ctx.l2DistrictType,
        l2_district_name: ctx.l2DistrictName,
      }
    : base
}

@Injectable()
export class CommunityIssueDispatchService extends createPrismaBase(
  MODELS.ExperimentRun,
) {
  constructor(
    private readonly experimentRuns: ExperimentRunsService,
    private readonly organizations: OrganizationsService,
    private readonly cronLock: CronLockService,
    // analytics.service sits on a circular import chain (analytics -> users
    // -> campaigns -> analytics); a plain class-typed param here makes SWC's
    // reflected design:paramtypes eagerly capture AnalyticsService before
    // that cycle finishes loading, undefining an unrelated CampaignsService
    // dependency at DI time. forwardRef + WrapperType defers resolution.
    @Inject(forwardRef(() => AnalyticsService))
    private readonly analytics: WrapperType<AnalyticsService>,
  ) {
    super()
  }

  /**
   * Called when a new elected office is created. Dispatches one run of each
   * community-issue experiment type for the org. A FAILED-only prior run is
   * not blocking: the first attempt did not succeed and nothing else
   * re-dispatches it (crons are flagged off at launch; a dead run is only
   * marked FAILED by the gp-ai-projects ECS task-reaper, which does not
   * re-dispatch). Blocks on QUEUED, RUNNING, AWAITING_RESUME, and
   * COMPLETED to avoid spawning a duplicate live run.
   */
  async onElectedOfficeCreated(electedOffice: ElectedOffice): Promise<void> {
    if (!isAutomationEnabled()) {
      this.logger.info(
        { electedOfficeId: electedOffice.id },
        'automation disabled; skipping community-issue signup dispatch',
      )
      return
    }

    const ctx = await this.resolveContext(electedOffice.organizationSlug)
    if (!ctx) return

    for (const experimentType of EXPERIMENT_TYPES) {
      const existing = await this.client.experimentRun.findFirst({
        where: {
          organizationSlug: electedOffice.organizationSlug,
          experimentType,
          status: {
            in: [
              ExperimentRunStatus.QUEUED,
              ExperimentRunStatus.RUNNING,
              ExperimentRunStatus.AWAITING_RESUME,
              ExperimentRunStatus.COMPLETED,
            ],
          },
        },
        select: { runId: true },
      })
      if (existing) {
        this.logger.info(
          {
            electedOfficeId: electedOffice.id,
            experimentType,
          },
          'community-issue run already exists; skipping signup dispatch',
        )
        continue
      }

      await this.experimentRuns.dispatchRun({
        type: experimentType,
        organizationSlug: electedOffice.organizationSlug,
        clerkUserId: ctx.clerkUserId,
        priority: 'HIGH',
        params: buildDispatchParams(
          electedOffice.organizationSlug,
          experimentType,
          ctx,
        ),
      })
    }
  }

  /**
   * Admin/ops path: dispatch both experiment types for a list of org slugs,
   * applying the serve-ICP gate and an in-flight-run check per type.
   * Blocks QUEUED + RUNNING + AWAITING_RESUME (in-flight) to prevent
   * duplicate concurrent runs. Terminal runs (COMPLETED/FAILED) are
   * intentionally re-dispatchable — manual refresh is the endpoint's purpose.
   */
  async dispatchForCohort(orgSlugs: string[]): Promise<DispatchSummary> {
    let dispatched = 0
    let skipped = 0

    for (const orgSlug of orgSlugs) {
      const ctx = await this.resolveContext(orgSlug)
      if (!ctx) {
        skipped++
        continue
      }

      if (ctx.isServeIcp !== true) {
        this.logger.info(
          { orgSlug, isServeIcp: ctx.isServeIcp },
          'dispatchForCohort: skipping org not serve-ICP',
        )
        skipped++
        continue
      }

      for (const experimentType of EXPERIMENT_TYPES) {
        const didDispatch = await this.dispatchTypeForOrg(
          orgSlug,
          experimentType,
          ctx,
        )
        if (didDispatch) {
          dispatched++
        } else {
          skipped++
        }
      }
    }

    return { dispatched, skipped }
  }

  /**
   * Staff self-serve path: dispatch a single experiment type for the staff
   * user's own org. Applies the same serve-ICP gate and in-flight check as
   * the admin cohort path. Returns the same summary shape so the caller can
   * tell whether the run actually fired or was skipped (gated / in-flight).
   */
  async dispatchSelfServe(
    orgSlug: string,
    experimentType: CommunityIssueExperimentType,
  ): Promise<DispatchSummary> {
    const ctx = await this.resolveContext(orgSlug)
    if (!ctx || ctx.isServeIcp !== true) {
      this.logger.info(
        { orgSlug, isServeIcp: ctx?.isServeIcp ?? null },
        'dispatchSelfServe: skipping org not serve-ICP',
      )
      return { dispatched: 0, skipped: 1 }
    }

    const didDispatch = await this.dispatchTypeForOrg(
      orgSlug,
      experimentType,
      ctx,
    )
    return didDispatch
      ? { dispatched: 1, skipped: 0 }
      : { dispatched: 0, skipped: 1 }
  }

  /**
   * Self-serve landing catch-up: dispatch both experiment types for the
   * caller's own org, skipping the 90-day-inactivity gate (landing on the
   * dashboard already proves activity). ICP eligibility and the in-flight
   * check still apply, same as every other dispatch path. Distinct from
   * `dispatchSelfServe` (staff-only, single type, manual refresh button).
   */
  async dispatchIfNeeded(orgSlug: string): Promise<DispatchSummary> {
    const ctx = await this.resolveContext(orgSlug)
    if (!ctx || ctx.isServeIcp !== true) {
      return { dispatched: 0, skipped: EXPERIMENT_TYPES.length }
    }

    let dispatched = 0
    let skipped = 0
    for (const experimentType of EXPERIMENT_TYPES) {
      const didDispatch = await this.dispatchTypeForOrg(
        orgSlug,
        experimentType,
        ctx,
        { skipActivityGate: true },
      )
      if (didDispatch) {
        dispatched++
      } else {
        skipped++
      }
    }
    return { dispatched, skipped }
  }

  private async dispatchTypeForOrg(
    orgSlug: string,
    experimentType: CommunityIssueExperimentType,
    ctx: ResolvedDispatchContext,
    { skipActivityGate = true }: { skipActivityGate?: boolean } = {},
  ): Promise<boolean> {
    const inFlight = await this.client.experimentRun.findFirst({
      where: {
        organizationSlug: orgSlug,
        experimentType,
        status: {
          in: [
            ExperimentRunStatus.QUEUED,
            ExperimentRunStatus.RUNNING,
            ExperimentRunStatus.AWAITING_RESUME,
          ],
        },
      },
      select: { runId: true },
    })
    if (inFlight) {
      this.logger.info(
        { orgSlug, experimentType, runId: inFlight.runId },
        'dispatchTypeForOrg: skipping org with in-flight run',
      )
      return false
    }

    // Activity gate: skip on the cron path when the user hasn't opened the
    // product within INACTIVITY_THRESHOLD_DAYS, firing a re-engagement
    // signal instead. Admin/staff dispatch paths (dispatchForCohort,
    // dispatchSelfServe) never set skipActivityGate, so they keep their
    // existing unconditional-dispatch behavior.
    if (!skipActivityGate && isInactiveUser(ctx.lastVisitedMs)) {
      await this.trackDispatchSkippedInactive(orgSlug, experimentType, ctx)
      return false
    }

    await this.experimentRuns.dispatchRun({
      type: experimentType,
      organizationSlug: orgSlug,
      clerkUserId: ctx.clerkUserId,
      params: buildDispatchParams(orgSlug, experimentType, ctx),
    })
    return true
  }

  private async trackDispatchSkippedInactive(
    orgSlug: string,
    experimentType: CommunityIssueExperimentType,
    ctx: ResolvedDispatchContext,
  ): Promise<void> {
    try {
      await this.analytics.track(
        ctx.userId,
        EVENTS.CommunityIssues.DispatchSkipped,
        {
          organizationSlug: orgSlug,
          experimentType,
          lastVisitedAt: ctx.lastVisitedMs ?? null,
          daysSinceLastVisit: ctx.lastVisitedMs
            ? differenceInCalendarDays(new Date(), new Date(ctx.lastVisitedMs))
            : null,
        },
      )
    } catch (err) {
      this.logger.error(
        { err, orgSlug, experimentType },
        '[SEGMENT] Failed to track Community Issues - Dispatch Skipped',
      )
    }
  }

  /**
   * Daily cron: dispatches trending_issues for orgs whose slug hashes to
   * today's UTC day-of-week bucket. One org slice per day keeps SQS fan-out
   * small (1/7th of the fleet per tick).
   */
  @Cron('0 8 * * *')
  async dispatchWeeklyTrendingIssues(): Promise<void> {
    if (!isAutomationEnabled()) {
      this.logger.info('automation disabled; skipping trending issues cron')
      return
    }

    const now = new Date()
    const claimed = await this.cronLock.tryClaimDailyRun(TRENDING_CRON_JOB, now)
    if (!claimed) return

    const todayBucket = now.getUTCDay()

    await this.dispatchSlice(
      'trending_issues',
      (slug) => bucketForSlug(slug, 7) === todayBucket,
      now,
    )

    await this.cronLock.markCompleted(TRENDING_CRON_JOB, now)
  }

  /**
   * Daily cron: dispatches top_community_issues for orgs whose slug hashes to
   * today's UTC day-of-month bucket (mod 28). Spreads dispatches across a
   * rolling 28-day window.
   */
  @Cron('0 9 * * *')
  async dispatchMonthlyTopIssues(): Promise<void> {
    if (!isAutomationEnabled()) {
      this.logger.info(
        'automation disabled; skipping top community issues cron',
      )
      return
    }

    const now = new Date()
    const claimed = await this.cronLock.tryClaimDailyRun(TOP_CRON_JOB, now)
    if (!claimed) return

    const todayBucket = topIssuesBucketForDate(now)

    await this.dispatchSlice(
      'top_community_issues',
      (slug) => bucketForSlug(slug, 28) === todayBucket,
      now,
    )

    await this.cronLock.markCompleted(TOP_CRON_JOB, now)
  }

  private async dispatchSlice(
    experimentType: CommunityIssueExperimentType,
    inBucket: (slug: string) => boolean,
    now: Date,
  ): Promise<void> {
    const offices = await this.client.electedOffice.findMany({
      select: { organizationSlug: true },
      orderBy: { organizationSlug: 'asc' },
    })

    const slice = offices.filter((o) => inBucket(o.organizationSlug))

    if (slice.length > DISPATCH_CAP_PER_TICK) {
      this.logger.warn(
        {
          experimentType,
          sliceSize: slice.length,
          cap: DISPATCH_CAP_PER_TICK,
          date: now.toISOString(),
        },
        'community-issue cron slice exceeds per-tick dispatch cap — truncating',
      )
    }

    const capped = slice.slice(0, DISPATCH_CAP_PER_TICK)

    for (const { organizationSlug } of capped) {
      const ctx = await this.resolveContext(organizationSlug)
      if (!ctx || ctx.isServeIcp !== true) continue

      await this.dispatchTypeForOrg(organizationSlug, experimentType, ctx, {
        skipActivityGate: false,
      }).catch((err: unknown) =>
        this.logger.error(
          { err, organizationSlug, experimentType },
          'community-issue cron dispatch failed for org; continuing',
        ),
      )
    }
  }

  private async resolveContext(
    organizationSlug: string,
  ): Promise<ResolvedDispatchContext | null> {
    const [eo, organization] = await Promise.all([
      this.client.electedOffice.findFirst({
        where: { organizationSlug },
        include: { user: true },
      }),
      this.client.organization.findUnique({
        where: { slug: organizationSlug },
      }),
    ])

    if (!eo?.user?.clerkId) {
      this.logger.warn(
        { organizationSlug },
        'community-issue dispatch: no elected office or user clerkId for org',
      )
      return null
    }

    const serveCtx = organization
      ? await this.organizations.resolveServeContext(organization)
      : null

    if (!serveCtx?.state || !serveCtx.positionName) {
      this.logger.warn(
        { organizationSlug },
        'community-issue dispatch: missing serve context (state or positionName)',
      )
      return null
    }

    const districtDescriptor = serveCtx.l2DistrictName
      ? `${serveCtx.l2DistrictName}, ${serveCtx.state}`
      : `${serveCtx.positionName}, ${serveCtx.state}`

    return {
      userId: eo.user.id,
      clerkUserId: eo.user.clerkId,
      state: serveCtx.state,
      positionName: serveCtx.positionName,
      districtDescriptor,
      l2DistrictType: serveCtx.l2DistrictType,
      l2DistrictName: serveCtx.l2DistrictName,
      isServeIcp: serveCtx.isServeIcp,
      lastVisitedMs: eo.user.metaData?.lastVisited,
    }
  }
}
