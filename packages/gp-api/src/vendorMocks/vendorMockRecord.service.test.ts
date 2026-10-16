import { useTestService } from '@/test-service'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { VendorMockVendor } from '@/generated/prisma'
import { VendorMockRecordService } from './vendorMockRecord.service'

// IS_NON_PROD_DEPLOY is a module-level constant computed at import time.
// Mock it as a getter so the non-prod gate passes in the test environment
// (where OTEL_SERVICE_ENVIRONMENT is unset) without mutating process.env.
vi.mock('@/shared/util/appEnvironment.util', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/shared/util/appEnvironment.util')>()
  return {
    ...actual,
    get IS_NON_PROD_DEPLOY() {
      return true
    },
  }
})

const service = useTestService()

describe('VendorMockRecordService', () => {
  let svc: VendorMockRecordService

  beforeEach(() => {
    svc = service.app.get(VendorMockRecordService)
  })

  const vendor = VendorMockVendor.geoapify
  const kind = 'routing_request'
  const state = { status: 'ok', waypoints: 3 }

  describe('upsert', () => {
    it('creates a record and round-trips all fields', async () => {
      const externalId = 'ext-1'
      const campaignId = 1

      const record = await svc.upsert(
        vendor,
        kind,
        externalId,
        state,
        campaignId,
      )

      expect(record.vendor).toBe(vendor)
      expect(record.kind).toBe(kind)
      expect(record.externalId).toBe(externalId)
      expect(record.campaignId).toBe(campaignId)
      expect(record.state).toEqual(state)
      expect(record.requests).toEqual([])
    })

    it('appends to requests array and caps at 10', async () => {
      const externalId = 'ext-cap'

      // Insert initial record
      await svc.upsert(vendor, kind, externalId, state)

      // Push 11 request bodies — only the last 10 should remain
      for (let i = 1; i <= 11; i++) {
        await svc.upsert(vendor, kind, externalId, state, undefined, {
          seq: i,
        })
      }

      const record = await svc.findUniqueOrThrow({
        where: {
          vendor_kind_externalId: { vendor, kind, externalId },
        },
      })

      const requests = Array.isArray(record.requests) ? record.requests : []
      expect(requests).toHaveLength(10)
      expect(requests[0]).toEqual({ seq: 2 })
      expect(requests[9]).toEqual({ seq: 11 })
    })
  })

  describe('findByCampaign', () => {
    it('returns only records for the given campaignId', async () => {
      await svc.upsert(vendor, kind, 'camp-a-1', state, 10)
      await svc.upsert(vendor, kind, 'camp-a-2', state, 10)
      await svc.upsert(vendor, kind, 'camp-b-1', state, 20)

      const results = await svc.findByCampaign(10)
      expect(results).toHaveLength(2)
      expect(results.every((r) => r.campaignId === 10)).toBe(true)
    })
  })

  describe('setFlag', () => {
    it('merges into state without overwriting other keys', async () => {
      const externalId = 'ext-flag'
      await svc.upsert(vendor, kind, externalId, { status: 'ok', score: 5 })

      await svc.setFlag(vendor, kind, externalId, 'fail', true)

      const record = await svc.findUniqueOrThrow({
        where: {
          vendor_kind_externalId: { vendor, kind, externalId },
        },
      })

      expect(record.state).toEqual({ status: 'ok', score: 5, fail: true })
    })
  })
})
