import { ExperimentRunsService } from '@/agentExperiments/services/experimentRuns.service'
import { CronLockService } from '@/cron/services/cronLock.service'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { ElectedOffice, ExperimentRunStatus } from '../../generated/prisma'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { bucketForSlug } from '../communityIssueFeedBucketing'

const EXPERIMENT_TYPES = ['top_community_issues', 'trending_issues'] as const

type CommunityIssueExperimentType = (typeof EXPERIMENT_TYPES)[number]

// Per-cron-tick cap: limits how many dispatches can fire in a single run of
// the daily cron (both trending and top share this constant).
const DISPATCH_CAP_PER_TICK = 200

const isAutomationEnabled = () =>
  process.env.MEETINGS_AUTOMATION_ENABLED === 'true'

const TRENDING_CRON_JOB = 'trending_issues'
const TOP_CRON_JOB = 'top_community_issues'

type DispatchSummary = { dispatched: number; skipped: number }

@Injectable()
export class CommunityIssueFeedDispatchService extends createPrismaBase(
  MODELS.ExperimentRun,
) {
  constructor(
    private readonly experimentRuns: ExperimentRunsService,
    private readonly organizations: OrganizationsService,
    private readonly cronLock: CronLockService,
  ) {
    super()
  }

  /**
   * Called when a new elected office is created. Dispatches one run of each
   * community-issue experiment type for the org. A FAILED-only prior run is
   * not blocking: the first attempt did not succeed and nothing else
   * re-dispatches it (crons are flagged off at launch; sweepStaleRuns only
   * marks stale runs FAILED). Blocks on QUEUED, RUNNING, AWAITING_RESUME, and
   * COMPLETED to avoid spawning a duplicate live run.
   */
  async onElectedOfficeCreated(electedOffice: ElectedOffice): Promise<void> {
    if (!isAutomationEnabled()) {
      this.logger.info(
        { electedOfficeId: electedOffice.id },
        'automation disabled; skipping community-issue feed signup dispatch',
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
        params: {
          organization_slug: electedOffice.organizationSlug,
          state: ctx.state,
          office: ctx.positionName,
          district_descriptor: ctx.districtDescriptor,
        },
      })
    }
  }

  /**
   * Admin/ops path: dispatch both experiment types for a list of org slugs,
   * applying the serve-ICP gate and an in-flight-run check per type.
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
        const inFlight = await this.client.experimentRun.findFirst({
          where: {
            organizationSlug: orgSlug,
            experimentType,
            status: {
              in: [
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
            'dispatchForCohort: skipping org with in-flight run',
          )
          skipped++
          continue
        }

        await this.experimentRuns.dispatchRun({
          type: experimentType,
          organizationSlug: orgSlug,
          clerkUserId: ctx.clerkUserId,
          params: {
            organization_slug: orgSlug,
            state: ctx.state,
            office: ctx.positionName,
            district_descriptor: ctx.districtDescriptor,
          },
        })
        dispatched++
      }
    }

    return { dispatched, skipped }
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

    const todayBucket = Math.min(now.getUTCDate(), 28) - 1

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

      const inFlight = await this.client.experimentRun.findFirst({
        where: {
          organizationSlug,
          experimentType,
          status: {
            in: [
              ExperimentRunStatus.RUNNING,
              ExperimentRunStatus.AWAITING_RESUME,
            ],
          },
        },
        select: { runId: true },
      })
      if (inFlight) continue

      await this.experimentRuns
        .dispatchRun({
          type: experimentType,
          organizationSlug,
          clerkUserId: ctx.clerkUserId,
          params: {
            organization_slug: organizationSlug,
            state: ctx.state,
            office: ctx.positionName,
            district_descriptor: ctx.districtDescriptor,
          },
        })
        .catch((err: unknown) =>
          this.logger.error(
            { err, organizationSlug, experimentType },
            'community-issue cron dispatch failed for org; continuing',
          ),
        )
    }
  }

  private async resolveContext(organizationSlug: string): Promise<{
    clerkUserId: string
    state: string
    positionName: string
    districtDescriptor: string
    isServeIcp?: boolean | null
  } | null> {
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
      clerkUserId: eo.user.clerkId,
      state: serveCtx.state,
      positionName: serveCtx.positionName,
      districtDescriptor,
      isServeIcp: serveCtx.isServeIcp,
    }
  }
}
