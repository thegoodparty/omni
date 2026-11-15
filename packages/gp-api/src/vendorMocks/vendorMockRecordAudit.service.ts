import { Injectable } from '@nestjs/common'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { IS_NON_PROD_DEPLOY } from '@/shared/util/appEnvironment.util'
import { recordVendorMockRecordRows } from './vendorMockRecord.metrics'

// gp-api has no DB-backed alert path, so the count is exported as a gauge and
// the `vendor-mock-record-rows-in-prod` Grafana rule pages when it is above 0.
// Standalone rather than part of the vendor drift probe, so the two can ship
// and fail independently. Run daily by the vendorMockRecordAudit schedule
// (src/jobs/jobs.registry.ts).
@Injectable()
export class VendorMockRecordAuditService extends createPrismaBase(
  MODELS.VendorMockRecord,
) {
  // Prod only: non-prod legitimately holds mock rows, and the alert is only
  // provisioned for prod anyway.
  async reportMockRecordRows(): Promise<void> {
    if (IS_NON_PROD_DEPLOY) return
    recordVendorMockRecordRows(await this.model.count())
  }
}
