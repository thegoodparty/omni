import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { subDays } from 'date-fns'
import { ExperimentRunStatus } from '../../../generated/prisma'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { isDateTodayOrFuture } from 'src/shared/util/date.util'
import { CronLockService } from '@/cron/services/cronLock.service'
import { ExperimentRunsService } from '@/agentExperiments/services/experimentRuns.service'
import { CampaignWith } from '@/campaigns/campaigns.types'
import {
  CAMPAIGN_TRACKER_EXPERIMENT_TYPE,
  CAMPAIGN_TRACKER_WEEKLY_CRON_JOB,
} from '../campaignTracker.consts'
import { CampaignTrackerTasksService } from './campaignTrackerTasks.service'

// Global cron-automation guard (matches meeting_briefing). This is an env gate,
// not a per-cohort flag: who gets generated for is decided by eligibility (a
// campaign is on the new tracker only after story + plan + launch/pre-launch).
const isAutomationEnabled = () =>
  process.env.CAMPAIGN_TRACKER_AUTOMATION_ENABLED === 'true'

// How recently a run must have fired for a campaign to skip it this week.
const WEEKLY_COVERAGE_DAYS = 6

@Injectable()
export class CampaignTrackerDispatchService extends createPrismaBase(
  MODELS.Campaign,
) {
  constructor(
    private readonly cronLock: CronLockService,
    private readonly experimentRuns: ExperimentRunsService,
    private readonly trackerTasks: CampaignTrackerTasksService,
  ) {
    super()
  }

  // Sunday morning re-prioritization. A run can take a while; the Monday digest
  // reads whatever this produced. No batching — the subagent-concurrency cap
  // bounds load.
  @Cron('0 9 * * 0', { timeZone: 'America/Chicago' })
  async dispatchWeeklyRegen(): Promise<void> {
    if (!isAutomationEnabled()) {
      this.logger.info('tracker automation disabled; skipping weekly cron')
      return
    }

    const now = new Date()
    const claimed = await this.cronLock.tryClaimDailyRun(
      CAMPAIGN_TRACKER_WEEKLY_CRON_JOB,
      now,
    )
    if (!claimed) return

    // On the new tracker = has tracker rows, which only exist after story +
    // plan + launch/pre-launch generation — so this is the cohort gate.
    const campaigns = await this.model.findMany({
      where: { isActive: true, campaignTrackerTasks: { some: {} } },
      include: { user: true },
    })

    for (const campaign of campaigns) {
      await this.dispatchIfNeeded(campaign, now).catch((err: unknown) =>
        this.logger.error(
          { err, campaignId: campaign.id },
          'tracker weekly dispatch failed, continuing',
        ),
      )
    }

    await this.cronLock.markCompleted(CAMPAIGN_TRACKER_WEEKLY_CRON_JOB, now)
  }

  private async dispatchIfNeeded(
    campaign: CampaignWith<'user'>,
    now: Date,
  ): Promise<void> {
    // Primary-only campaigns have no general electionDate yet; fall back to the
    // primary so the weekly cron still re-prioritizes them (mirrors
    // dispatchGeneration / resolveElectionDate).
    const effectiveDate =
      campaign.details?.electionDate ?? campaign.details?.primaryElectionDate
    if (!isDateTodayOrFuture(effectiveDate, now)) return

    // Coverage dedup: skip if a non-failed run already fired for this org this
    // week. A FAILED run is ignored so a stuck week still retries (it produced
    // no tasks), instead of being blocked until the window expires.
    const recent = await this.experimentRuns.findFirst({
      where: {
        organizationSlug: campaign.organizationSlug,
        experimentType: CAMPAIGN_TRACKER_EXPERIMENT_TYPE,
        status: { not: ExperimentRunStatus.FAILED },
        createdAt: { gte: subDays(now, WEEKLY_COVERAGE_DAYS) },
      },
    })
    if (recent) return

    await this.trackerTasks.dispatchGeneration(campaign, 'weekly')
  }
}
