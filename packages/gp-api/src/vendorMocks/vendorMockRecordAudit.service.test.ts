import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VendorMockVendor } from '@/generated/prisma'
import {
  appEnvOverrides,
  useAppEnvOverrides,
} from '@/shared/test-utils/appEnvOverrides'
import { useTestService } from '@/test-service'
import * as vendorMockRecordMetrics from './vendorMockRecord.metrics'
import { VendorMockRecordAuditService } from './vendorMockRecordAudit.service'

useAppEnvOverrides({ IS_NON_PROD_DEPLOY: false })

const service = useTestService({ jobs: true })

describe('vendorMockRecordAudit schedule', () => {
  let recordVendorMockRecordRows: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    appEnvOverrides.IS_NON_PROD_DEPLOY = false
    recordVendorMockRecordRows = vi
      .spyOn(vendorMockRecordMetrics, 'recordVendorMockRecordRows')
      .mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('records the row count', async () => {
    await service.prisma.vendorMockRecord.create({
      data: {
        vendor: VendorMockVendor.geoapify,
        kind: 'routing_request',
        externalId: 'audit-1',
        state: {},
      },
    })

    await service.jobs.runSchedule('vendorMockRecordAudit')

    expect(recordVendorMockRecordRows).toHaveBeenCalledTimes(1)
    expect(recordVendorMockRecordRows).toHaveBeenCalledWith(1)
  })

  it('records an explicit zero when the table is empty', async () => {
    await service.jobs.runSchedule('vendorMockRecordAudit')

    expect(recordVendorMockRecordRows).toHaveBeenCalledWith(0)
  })

  it('retries when the count fails', async () => {
    const audit = service.app.get(VendorMockRecordAuditService)
    vi.spyOn(audit['model'], 'count').mockRejectedValueOnce(
      new Error('db down'),
    )

    await service.jobs.runSchedule('vendorMockRecordAudit')

    expect(recordVendorMockRecordRows).toHaveBeenCalledTimes(1)
    expect(recordVendorMockRecordRows).toHaveBeenCalledWith(0)
  })

  it('does nothing outside prod', async () => {
    appEnvOverrides.IS_NON_PROD_DEPLOY = true

    await service.jobs.runSchedule('vendorMockRecordAudit')

    expect(recordVendorMockRecordRows).not.toHaveBeenCalled()
  })
})
