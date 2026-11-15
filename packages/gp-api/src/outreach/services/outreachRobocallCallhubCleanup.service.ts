import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import type { JobRun, ScheduleData } from '@/jobs/jobs.registry'
import { JobsService } from '@/jobs/jobs.service'
import { CallhubCampaignService } from '@/vendors/callhub/services/callhubCampaign.service'
import { RobocallOrphanedCampaignService } from './robocallOrphanedCampaign.service'
import { VENDOR_CRONS_ENABLED } from 'src/shared/util/appEnvironment.util'

// Retires orphaned PAUSED CallHub voice-broadcast campaigns — ones recorded in
// RobocallOrphanedCampaign when a hold re-authorize nulled a draft's staged
// campaign, or a staging commit was lost. Each is ABORTed (status 3) so it can
// never dial and stops cluttering the account, then stamped abortedAt. A PAUSED
// campaign charges nothing, so this is account hygiene, not money safety — but
// it only ever ABORTs pk_strs recorded at a known abandonment point (never an
// account-wide list-and-reconcile), so it can never abort a live, still-
// referenced campaign that is meant to dial.
@Injectable()
export class OutreachRobocallCallhubCleanupService {
  constructor(
    private readonly orphans: RobocallOrphanedCampaignService,
    private readonly callhubCampaign: CallhubCampaignService,
    private readonly logger: PinoLogger,
    private readonly jobs: JobsService,
  ) {
    this.logger.setContext(OutreachRobocallCallhubCleanupService.name)
  }

  // Vendor-cron gate (a real CallHub call, mocked where VENDOR_CRONS_ENABLED is on): ABORT only ever
  // makes a campaign LESS likely to dial, so it needs no gate beyond VENDOR_CRONS_ENABLED,
  // and the orphans it clears accumulate independently of any run. The
  // robocallCallhubCleanupSweep schedule (src/jobs/jobs.registry.ts) sends one
  // robocallOrphanedCampaignAbort job per orphan; the per-row markAborted CAS
  // makes a double run idempotent. Each job checks the gate too, since any
  // gp-api pointed at a database works its queues.
  async sweepOrphanedCampaigns(sweep: JobRun<ScheduleData>): Promise<void> {
    if (!VENDOR_CRONS_ENABLED) return

    const orphans = await this.orphans.findUnaborted()
    await this.jobs.sendMany(
      'robocallOrphanedCampaignAbort',
      orphans.map(({ id }) => ({
        data: { orphanedCampaignId: id },
        key: `${id}:${sweep.id}`,
      })),
    )
  }

  // A CallHub failure throws and the job retries the ABORT.
  async abortOrphanedCampaign(
    job: JobRun<{ orphanedCampaignId: number }>,
  ): Promise<void> {
    if (!VENDOR_CRONS_ENABLED) return

    const orphan = await this.orphans.findFirst({
      where: { id: job.data.orphanedCampaignId, abortedAt: null },
    })
    if (!orphan) return
    // ABORT is idempotent enough for retry: a campaign already ABORTed/ENDed
    // either no-ops or 502s, and a 502 just leaves abortedAt null to retry.
    await this.callhubCampaign.abortVoiceBroadcast(orphan.campaignPkStr)
    await this.orphans.markAborted(orphan.id)
  }
}
