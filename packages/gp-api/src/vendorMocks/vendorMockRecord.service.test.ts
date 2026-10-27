import { useTestService } from '@/test-service'
import { beforeEach, describe, expect, it } from 'vitest'
import { VendorMockVendor } from '@/generated/prisma'
import { VendorMockRecordService } from './vendorMockRecord.service'
import { useAppEnvOverrides } from '@/shared/test-utils/appEnvOverrides'

// IS_NON_PROD_DEPLOY is a module-level constant computed at import time.
// Override it so the non-prod gate passes in the test environment (where
// OTEL_SERVICE_ENVIRONMENT is unset) without mutating process.env.
useAppEnvOverrides({ IS_NON_PROD_DEPLOY: true })

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
    it('returns only the given campaign, not others or unscoped rows', async () => {
      await svc.upsert(vendor, kind, 'camp-a-1', state, 10)
      await svc.upsert(vendor, kind, 'camp-a-2', state, 10)
      await svc.upsert(vendor, kind, 'camp-b-1', state, 20)
      await svc.upsert(vendor, kind, 'global-1', state)

      const results = await svc.findByCampaign(10)
      expect(results.map((r) => r.externalId).sort()).toEqual([
        'camp-a-1',
        'camp-a-2',
      ])
    })
  })

  describe('findCallhubForCampaign', () => {
    const seedRobocall = async (pk: string | null) => {
      const slug = `campaign-${service.user.id}-${Math.random()}`
      await service.prisma.organization.create({
        data: { slug, ownerId: service.user.id, positionId: 'pos-1' },
      })
      const campaign = await service.prisma.campaign.create({
        data: {
          organizationSlug: slug,
          userId: service.user.id,
          slug,
          isPro: true,
          details: {},
          data: {},
          aiContent: {},
        },
      })
      const outreach = await service.prisma.outreach.create({
        data: {
          campaignId: campaign.id,
          organizationSlug: slug,
          outreachType: 'robocall',
          status: 'pending',
          date: new Date(),
        },
      })
      await service.prisma.outreachRobocall.create({
        data: {
          outreachId: outreach.id,
          audioKey: `robocall/${slug}.mp3`,
          callbackNumber: '+15125550123',
          billableCount: 3,
          amountInCents: 100,
          settleState: 'staging',
          callhubCampaignPkStr: pk,
        },
      })
      return campaign.id
    }

    it('returns the vb_campaign together with the phonebook it was created against', async () => {
      const callhub = VendorMockVendor.callhub
      await svc.upsert(callhub, 'phonebook', 'pb-1', { count: 3 })
      await svc.upsert(callhub, 'phonebook', 'pb-other', { count: 9 })
      await svc.upsert(callhub, 'vb_campaign', 'vb-1', {
        status: 2,
        phonebooks: ['pb-1'],
      })
      const campaignId = await seedRobocall('vb-1')

      const records = await svc.findCallhubForCampaign(campaignId)
      expect(records.map((r) => `${r.kind}:${r.externalId}`).sort()).toEqual([
        'phonebook:pb-1',
        'vb_campaign:vb-1',
      ])
    })

    it('returns only the vb_campaign when it recorded no phonebooks', async () => {
      await svc.upsert(VendorMockVendor.callhub, 'vb_campaign', 'vb-2', {
        status: 2,
      })
      const campaignId = await seedRobocall('vb-2')

      const records = await svc.findCallhubForCampaign(campaignId)
      expect(records.map((r) => r.externalId)).toEqual(['vb-2'])
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
