import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { isBefore, max, subDays } from 'date-fns'
import {
  ElectedOffice,
  ExperimentRunStatus,
  OrdinanceConfidence,
} from '../../generated/prisma'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { CronLockService } from '@/cron/services/cronLock.service'
import { ExperimentRunsService } from '@/agentExperiments/services/experimentRuns.service'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { FIND_EXISTING_ORDINANCES } from '../ordinances.constants'

// Own flag (campaignTracker precedent): ordinance sourcing rolls out
// independently of the meetings-automation fleet.
const isAutomationEnabled = () =>
  process.env.ORDINANCES_AUTOMATION_ENABLED === 'true'

// A hung election-api connection must not stall the uncapped tick — the
// per-org resolve gets a hard deadline and the org is skipped for the day.
const contextResolveTimeoutMs = () =>
  Number(process.env.ORDINANCE_RESOLVE_TIMEOUT_MS ?? 15_000)

const withDeadline = <T>(promise: Promise<T>, ms: number): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_resolve, reject) =>
      setTimeout(
        () => reject(new Error(`resolve timed out after ${ms}ms`)),
        ms,
      ),
    ),
  ])

// Manifest maxLength for office. customPositionName is unbounded user input;
// the place name the agent derives sits at the front of the string, so
// truncation is safe.
const OFFICE_MAX_LENGTH = 256

const STATE_CODE = /^[A-Z]{2}$/

const REFRESH_CRON_JOB = 'find_existing_ordinances_refresh'

// Codes churn slowly; a 60-day cycle keeps records current without paying
// for daily agent runs across the fleet.
const RECORD_REFRESH_DAYS = 60

// Short leash for flip candidates: a low-confidence not-found record is the
// result most likely to be wrong, so re-check it well before the full
// refresh window.
const LOW_CONFIDENCE_RECHECK_DAYS = 14

// A persistently-failing org must not be re-dispatched every day. Skip it
// while a FAILED run sits inside this window, then let it retry.
const FAILED_RETRY_BACKOFF_DAYS = 2

// Not a cap — the agent platform's concurrency limiter paces execution.
// This only flags unexpected eligibility volume for the ops alarm.
const EXPECTED_VOLUME_WARN_THRESHOLD = 400

type ResolvedDispatchContext = {
  clerkUserId: string | undefined
  state: string
  positionName: string
  isServeIcp?: boolean | null
}

type DispatchableOrg = {
  clerkUserId: string | undefined
  state: string
  office: string
}

@Injectable()
export class OrdinanceDispatchService extends createPrismaBase(
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
   * Called when a new elected office is created. One-time semantic: any live
   * or COMPLETED prior run blocks re-dispatch — the code corpus for a place
   * does not change per signup, so a FAILED-only history is the only state
   * that warrants another attempt. Unlike the other signup hooks this gates
   * on serve-ICP, fail-closed: sourcing a municipal code only pays off for
   * orgs the serve product targets.
   */
  // Final pre-dispatch re-check: the eligibility checks run before the slow
  // serve-context resolve, so a concurrent path (signup hook vs cron tick)
  // can enqueue during that window. This narrows the race to milliseconds;
  // a residual duplicate is bounded (one run) and persists idempotently.
  private async runAppearedDuringResolve(
    organizationSlug: string,
  ): Promise<boolean> {
    const appeared = await this.model.findFirst({
      where: {
        organizationSlug,
        experimentType: FIND_EXISTING_ORDINANCES,
        status: {
          in: [ExperimentRunStatus.QUEUED, ExperimentRunStatus.RUNNING],
        },
      },
      select: { runId: true },
    })
    if (appeared) {
      this.logger.info(
        { organizationSlug, runId: appeared.runId },
        'ordinance_dispatch_skipped: run appeared during resolve',
      )
      return true
    }
    return false
  }

  async onElectedOfficeCreated(electedOffice: ElectedOffice): Promise<void> {
    if (!isAutomationEnabled()) {
      this.logger.info(
        { electedOfficeId: electedOffice.id },
        'ordinance_dispatch_skipped: automation disabled',
      )
      return
    }

    const { organizationSlug } = electedOffice

    const existing = await this.model.findFirst({
      where: {
        organizationSlug,
        experimentType: FIND_EXISTING_ORDINANCES,
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
        { organizationSlug, runId: existing.runId },
        'ordinance_dispatch_skipped: run already exists',
      )
      return
    }

    const dispatchable = await this.resolveDispatchableOrg(organizationSlug)
    if (!dispatchable) return
    if (await this.runAppearedDuringResolve(organizationSlug)) return

    await this.experimentRuns.dispatchRun({
      type: FIND_EXISTING_ORDINANCES,
      organizationSlug,
      clerkUserId: dispatchable.clerkUserId,
      priority: 'HIGH',
      params: {
        organization_slug: organizationSlug,
        state: dispatchable.state,
        office: dispatchable.office,
      },
    })
  }

  /**
   * Daily refresh: re-dispatches find_existing_ordinances for orgs whose
   * record has gone stale (60 days), re-checks low-confidence not-found
   * records on a 14-day leash, and backfills office orgs that never got a
   * run. Org selection is broad (any org with an elected office); the
   * per-org serve-ICP gate does the authoritative filtering, since ICP
   * truth lives on the election-api position and is not queryable in bulk
   * from this DB. 10:00 UTC — offset from the sibling crons at 7/8/9 to
   * spread SQS load.
   */
  @Cron('0 10 * * *')
  async dispatchDailyRefresh(): Promise<void> {
    if (!isAutomationEnabled()) {
      this.logger.info('ordinance_refresh_skipped: automation disabled')
      return
    }

    // Pin one timestamp so the lease claim, the staleness cutoffs, and the
    // completion mark all resolve to the same UTC run-date even if the loop
    // below crosses midnight.
    const now = new Date()
    const claimed = await this.cronLock.tryClaimDailyRun(REFRESH_CRON_JOB, now)
    if (!claimed) return

    const eligible = await this.selectOrgsNeedingRun(now)
    if (eligible.length > EXPECTED_VOLUME_WARN_THRESHOLD) {
      this.logger.warn(
        {
          eligible: eligible.length,
          threshold: EXPECTED_VOLUME_WARN_THRESHOLD,
        },
        'ordinance refresh eligibility unexpectedly high; dispatching all',
      )
    }

    let dispatched = 0
    let failed = 0
    for (const organizationSlug of eligible) {
      try {
        const inFlight = await this.model.findFirst({
          where: {
            organizationSlug,
            experimentType: FIND_EXISTING_ORDINANCES,
            status: {
              in: [ExperimentRunStatus.QUEUED, ExperimentRunStatus.RUNNING],
            },
          },
          select: { runId: true },
        })
        if (inFlight) {
          this.logger.info(
            { organizationSlug, runId: inFlight.runId },
            'ordinance_refresh_skipped: in-flight run exists',
          )
          continue
        }

        const dispatchable = await withDeadline(
          this.resolveDispatchableOrg(organizationSlug),
          contextResolveTimeoutMs(),
        )
        if (!dispatchable) continue
        if (await this.runAppearedDuringResolve(organizationSlug)) continue

        await this.experimentRuns.dispatchRun({
          type: FIND_EXISTING_ORDINANCES,
          organizationSlug,
          clerkUserId: dispatchable.clerkUserId,
          params: {
            organization_slug: organizationSlug,
            state: dispatchable.state,
            office: dispatchable.office,
          },
        })
        dispatched++
      } catch (err) {
        failed++
        this.logger.error(
          { err, organizationSlug },
          'ordinance refresh dispatch failed for org; continuing',
        )
      }
    }

    this.logger.info(
      { eligible: eligible.length, dispatched, failed },
      'ordinance refresh cron finished',
    )
    await this.cronLock.markCompleted(REFRESH_CRON_JOB, now)
  }

  private async selectOrgsNeedingRun(now: Date): Promise<string[]> {
    const staleCutoff = subDays(now, RECORD_REFRESH_DAYS)
    const recheckCutoff = subDays(now, LOW_CONFIDENCE_RECHECK_DAYS)
    const failedBackoffCutoff = subDays(now, FAILED_RETRY_BACKOFF_DAYS)

    const [offices, records, runs] = await Promise.all([
      this.client.electedOffice.findMany({
        select: { organizationSlug: true },
        orderBy: { organizationSlug: 'asc' },
      }),
      this.client.ordinanceCodeRecord.findMany({
        select: {
          organizationSlug: true,
          verifiedAt: true,
          confidence: true,
          codeFound: true,
        },
      }),
      this.model.findMany({
        where: {
          experimentType: FIND_EXISTING_ORDINANCES,
          OR: [
            {
              status: {
                in: [
                  ExperimentRunStatus.QUEUED,
                  ExperimentRunStatus.RUNNING,
                  ExperimentRunStatus.COMPLETED,
                ],
              },
            },
            {
              status: ExperimentRunStatus.FAILED,
              // failure time, not dispatch time — a run that fails days after
              // it was created must still get the full backoff (updatedAt is
              // stamped at the terminal transition)
              updatedAt: { gte: failedBackoffCutoff },
            },
          ],
        },
        select: { organizationSlug: true, status: true, updatedAt: true },
      }),
    ])

    const recordBySlug = new Map(records.map((r) => [r.organizationSlug, r]))
    const inFlightSlugs = new Set<string>()
    const recentlyFailedSlugs = new Set<string>()
    const lastCompletedBySlug = new Map<string, Date>()
    for (const run of runs) {
      if (run.status === ExperimentRunStatus.COMPLETED) {
        const prev = lastCompletedBySlug.get(run.organizationSlug)
        lastCompletedBySlug.set(
          run.organizationSlug,
          prev ? max([prev, run.updatedAt]) : run.updatedAt,
        )
      } else if (run.status === ExperimentRunStatus.FAILED) {
        recentlyFailedSlugs.add(run.organizationSlug)
      } else {
        inFlightSlugs.add(run.organizationSlug)
      }
    }

    return offices
      .map((o) => o.organizationSlug)
      .filter((slug) => {
        if (inFlightSlugs.has(slug) || recentlyFailedSlugs.has(slug)) {
          return false
        }
        const record = recordBySlug.get(slug)
        const lastCompleted = lastCompletedBySlug.get(slug)
        if (!record) {
          return !lastCompleted || isBefore(lastCompleted, staleCutoff)
        }
        // A COMPLETED run whose result never-regress rejected leaves
        // verifiedAt untouched; counting the run as an attempt keeps a
        // permanently-rejected org on the leash cycle instead of
        // re-dispatching it every day.
        const lastAttempt = lastCompleted
          ? max([record.verifiedAt, lastCompleted])
          : record.verifiedAt
        if (isBefore(lastAttempt, staleCutoff)) return true
        return (
          record.confidence === OrdinanceConfidence.LOW &&
          !record.codeFound &&
          isBefore(lastAttempt, recheckCutoff)
        )
      })
  }

  private async resolveDispatchableOrg(
    organizationSlug: string,
  ): Promise<DispatchableOrg | null> {
    const ctx = await this.resolveContext(organizationSlug)
    if (!ctx) return null

    if (ctx.isServeIcp !== true) {
      this.logger.info(
        { organizationSlug, isServeIcp: ctx.isServeIcp ?? null },
        'ordinance_dispatch_skipped: org not serve-ICP',
      )
      return null
    }

    const state = ctx.state.trim().toUpperCase()
    if (!STATE_CODE.test(state)) {
      this.logger.warn(
        { organizationSlug, state: ctx.state },
        'ordinance_dispatch_skipped: state is not a 2-letter code',
      )
      return null
    }

    return {
      clerkUserId: ctx.clerkUserId,
      state,
      office: ctx.positionName.slice(0, OFFICE_MAX_LENGTH),
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

    if (!eo) {
      this.logger.warn(
        { organizationSlug },
        'ordinance_dispatch_skipped: no elected office',
      )
      return null
    }

    const serveCtx = organization
      ? await this.organizations.resolveServeContext(organization)
      : null

    if (!serveCtx?.state || !serveCtx.positionName) {
      this.logger.warn(
        { organizationSlug },
        'ordinance_dispatch_skipped: missing serve context',
      )
      return null
    }

    return {
      clerkUserId: eo.user?.clerkId ?? undefined,
      state: serveCtx.state,
      positionName: serveCtx.positionName,
      isServeIcp: serveCtx.isServeIcp,
    }
  }
}
