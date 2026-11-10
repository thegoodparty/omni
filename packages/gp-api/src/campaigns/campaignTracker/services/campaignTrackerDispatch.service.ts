import { Injectable } from '@nestjs/common'
import { subDays } from 'date-fns'
import { ExperimentRunStatus, Prisma } from '../../../generated/prisma'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'
import { isDateTodayOrFuture } from 'src/shared/util/date.util'
import { ExperimentRunsService } from '@/agentExperiments/services/experimentRuns.service'
import { CampaignWith } from '@/campaigns/campaigns.types'
import { JobsService } from '@/jobs/jobs.service'
import type { JobRun } from '@/jobs/jobs.registry'
import { CAMPAIGN_TRACKER_EXPERIMENT_TYPE } from '../campaignTracker.consts'
import { CampaignTrackerTasksService } from './campaignTrackerTasks.service'

// Global cron-automation guard (matches meeting_briefing). This is an env gate,
// not a per-cohort flag: who gets generated for is decided by eligibility (a
// campaign is on the new tracker only after story + plan + launch/pre-launch).
const isAutomationEnabled = () =>
  process.env.CAMPAIGN_TRACKER_AUTOMATION_ENABLED === 'true'

// How recently a run must have fired for a campaign to skip it this week.
const WEEKLY_COVERAGE_DAYS = 6

const ON_NEW_TRACKER = {
  isActive: true,
  isDemo: false,
  campaignTrackerTasks: { some: {} },
} satisfies Prisma.CampaignWhereInput

@Injectable()
export class CampaignTrackerDispatchService extends createPrismaBase(
  MODELS.Campaign,
) {
  constructor(
    private readonly experimentRuns: ExperimentRunsService,
    private readonly trackerTasks: CampaignTrackerTasksService,
    private readonly jobs: JobsService,
  ) {
    super()
  }

  // The campaignTrackerWeekly schedule's worker: Thursday morning
  // re-prioritization, generating the upcoming Mon-Sun week. Running mid-week
  // (not Sunday) gives ~3 days for the downstream ClickUp email automations
  // to fire before Monday. A run can take a while; the Monday digest reads
  // whatever this produced. Sends one campaignTrackerRegen job per campaign;
  // the subagent-concurrency cap bounds load.
  async fanOutWeeklyRegen(): Promise<void> {
    if (!isAutomationEnabled()) {
      this.logger.info('tracker automation disabled; skipping weekly cron')
      return
    }

    // On the new tracker = has tracker rows, which only exist after story +
    // plan + launch/pre-launch generation — so this is the cohort gate.
    const campaigns = await this.model.findMany({
      where: ON_NEW_TRACKER,
      select: { id: true },
    })

    const day = new Date().toISOString().slice(0, 10)
    await this.jobs.sendMany(
      'campaignTrackerRegen',
      campaigns.map(({ id }) => ({
        data: { campaignId: id },
        key: `${id}:${day}`,
      })),
    )
  }

  // The campaignTrackerRegen job's worker.
  async regenerate(job: JobRun<{ campaignId: number }>): Promise<void> {
    const campaign = await this.model.findFirst({
      where: { id: job.data.campaignId, ...ON_NEW_TRACKER },
      include: { user: true },
    })
    if (!campaign) return
    await this.dispatchIfNeeded(campaign, new Date())
  }

  private async dispatchIfNeeded(
    campaign: CampaignWith<'user'>,
    now: Date,
  ): Promise<void> {
    // A lost-primary race is over: stop generating and tear down the plan's
    // deterministic outreach (general-election contact schedule) so no further
    // texts/robocalls are suggested. Checked here, before generation, because
    // the loss is recorded after the tracker (and its outreach) bootstrapped.
    if (campaign.primaryResult === 'lost') {
      await this.trackerTasks.removeOutreachTasks(campaign.id)
      return
    }

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
