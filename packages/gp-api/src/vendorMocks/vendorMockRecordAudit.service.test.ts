import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VendorMockVendor } from '@/generated/prisma'
import { CronLockService } from '@/cron/services/cronLock.service'
import { useTestService } from '@/test-service'
import { recordVendorMockRecordRows } from './vendorMockRecord.metrics'
import { VendorMockRecordAuditService } from './vendorMockRecordAudit.service'

const nonProd = vi.hoisted(() => ({ value: false }))

vi.mock('@/shared/util/appEnvironment.util', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/shared/util/appEnvironment.util')>()
  return {
    ...actual,
    get IS_NON_PROD_DEPLOY() {
      return nonProd.value
    },
  }
})

vi.mock('./vendorMockRecord.metrics', () => ({
  recordVendorMockRecordRows: vi.fn(),
}))

const service = useTestService()

describe('VendorMockRecordAuditService.reportMockRecordRows', () => {
  let audit: VendorMockRecordAuditService
  let cronLock: CronLockService

  beforeEach(() => {
    nonProd.value = false
    audit = service.app.get(VendorMockRecordAuditService)
    cronLock = service.app.get(CronLockService)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    vi.mocked(recordVendorMockRecordRows).mockClear()
    await service.prisma.vendorMockRecord.deleteMany()
  })

  it('records the row count and completes the claim', async () => {
    vi.spyOn(cronLock, 'tryClaimDailyRun').mockResolvedValue(true)
    const markCompleted = vi
      .spyOn(cronLock, 'markCompleted')
      .mockResolvedValue(undefined)
    await service.prisma.vendorMockRecord.create({
      data: {
        vendor: VendorMockVendor.geoapify,
        kind: 'routing_request',
        externalId: 'audit-1',
        state: {},
      },
    })

    await audit.reportMockRecordRows()

    expect(recordVendorMockRecordRows).toHaveBeenCalledWith(1)
    expect(markCompleted).toHaveBeenCalledTimes(1)
  })

  it('records an explicit zero when the table is empty', async () => {
    vi.spyOn(cronLock, 'tryClaimDailyRun').mockResolvedValue(true)
    vi.spyOn(cronLock, 'markCompleted').mockResolvedValue(undefined)

    await audit.reportMockRecordRows()

    expect(recordVendorMockRecordRows).toHaveBeenCalledWith(0)
  })

  it('does nothing when another replica holds the claim', async () => {
    vi.spyOn(cronLock, 'tryClaimDailyRun').mockResolvedValue(false)
    const markCompleted = vi.spyOn(cronLock, 'markCompleted')

    await audit.reportMockRecordRows()

    expect(recordVendorMockRecordRows).not.toHaveBeenCalled()
    expect(markCompleted).not.toHaveBeenCalled()
  })

  it('does nothing outside prod', async () => {
    nonProd.value = true
    const claim = vi.spyOn(cronLock, 'tryClaimDailyRun')

    await audit.reportMockRecordRows()

    expect(claim).not.toHaveBeenCalled()
    expect(recordVendorMockRecordRows).not.toHaveBeenCalled()
  })

  it('still seals the claim when the count fails', async () => {
    vi.spyOn(cronLock, 'tryClaimDailyRun').mockResolvedValue(true)
    const markCompleted = vi
      .spyOn(cronLock, 'markCompleted')
      .mockResolvedValue(undefined)
    vi.spyOn(audit['model'], 'count').mockRejectedValue(new Error('db down'))

    await audit.reportMockRecordRows()

    expect(recordVendorMockRecordRows).not.toHaveBeenCalled()
    expect(markCompleted).toHaveBeenCalledTimes(1)
  })
})
