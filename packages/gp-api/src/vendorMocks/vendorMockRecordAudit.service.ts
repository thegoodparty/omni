import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { CronLockService } from '@/cron/services/cronLock.service'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { EASTERN_TIMEZONE } from '@/shared/util/date.util'
import { IS_NON_PROD_DEPLOY } from '@/shared/util/appEnvironment.util'
import { recordVendorMockRecordRows } from './vendorMockRecord.metrics'

const AUDIT_JOB = 'vendor_mock_record_audit'
// Off the hour, away from the 04:00 and 05:00 jobs.
const AUDIT_CRON = '17 6 * * *'

// gp-api has no DB-backed alert path, so the count is exported as a gauge and
// the `vendor-mock-record-rows-in-prod` Grafana rule pages when it is above 0.
// Standalone rather than part of the vendor drift probe, so the two can ship
// and fail independently.
@Injectable()
export class VendorMockRecordAuditService extends createPrismaBase(
  MODELS.VendorMockRecord,
) {
  constructor(private readonly cronLock: CronLockService) {
    super()
  }

  // Prod only: non-prod legitimately holds mock rows, and the alert is only
  // provisioned for prod anyway.
  @Cron(AUDIT_CRON, { name: AUDIT_JOB, timeZone: EASTERN_TIMEZONE })
  async reportMockRecordRows(): Promise<void> {
    if (IS_NON_PROD_DEPLOY) return

    const now = new Date()
    if (!(await this.cronLock.tryClaimDailyRun(AUDIT_JOB, now))) return

    try {
      recordVendorMockRecordRows(await this.model.count())
    } catch (err) {
      // Seal the lease in `finally` regardless: this fires once a day, so a
      // claim left open would be reclaimed only after the stale window, long
      // after the daily tick, and the day's reading would be lost silently.
      this.logger.error({ err }, 'vendor mock record row count failed')
    } finally {
      await this.cronLock.markCompleted(AUDIT_JOB, now)
    }
  }
}
