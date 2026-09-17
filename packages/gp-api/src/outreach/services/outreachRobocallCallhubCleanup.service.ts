import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { PinoLogger } from 'nestjs-pino'
import { EASTERN_TIMEZONE } from '@/shared/util/date.util'
import { CallhubCampaignService } from '@/vendors/callhub/services/callhubCampaign.service'
import { RobocallOrphanedCampaignService } from './robocallOrphanedCampaign.service'

// A slot away from the CallHub-heavy staging (:07) / send (:04) bursts, since
// this also talks to the rate-limited CallHub API. Orphans are rare, so cadence
// is not critical.
const ROBOCALL_CALLHUB_CLEANUP_CRON = '0,10,20,30,40,50 * * * *'
const ROBOCALL_CALLHUB_CLEANUP_JOB = 'robocallCallhubCleanupSweep'

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
  ) {
    this.logger.setContext(OutreachRobocallCallhubCleanupService.name)
  }

  // Prod-only (a real CallHub call, stubbed on dev/preview): ABORT only ever
  // makes a campaign LESS likely to dial, so it needs no gate beyond prod-only,
  // and the orphans it clears accumulate independently of any run. No
  // CronLockService — the per-row markAborted CAS makes a double-run idempotent
  // across replicas.
  @Cron(ROBOCALL_CALLHUB_CLEANUP_CRON, {
    name: ROBOCALL_CALLHUB_CLEANUP_JOB,
    timeZone: EASTERN_TIMEZONE,
  })
  async sweepOrphanedCampaigns(): Promise<void> {
    if (process.env.OTEL_SERVICE_ENVIRONMENT !== 'prod') return

    const orphans = await this.orphans.findUnaborted()
    for (const orphan of orphans) {
      try {
        // ABORT is idempotent enough for retry: a campaign already ABORTed/ENDed
        // either no-ops or 502s, and a 502 just leaves abortedAt null to retry.
        await this.callhubCampaign.abortVoiceBroadcast(orphan.campaignPkStr)
        await this.orphans.markAborted(orphan.id)
      } catch (err) {
        // Per-record isolation: one campaign's CallHub failure must not abort the
        // rest of the sweep. The row stays unaborted and retries next pass.
        this.logger.error(
          { err, campaignPkStr: orphan.campaignPkStr },
          'robocall orphaned-campaign abort failed; continuing sweep',
        )
      }
    }
  }
}
