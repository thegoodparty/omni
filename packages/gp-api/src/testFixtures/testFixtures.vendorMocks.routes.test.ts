import { HttpStatus } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  OfficeLevel,
  OutreachStatus,
  OutreachType,
  RobocallSettleState,
  TcrComplianceStatus,
  UserRole,
  VendorMockVendor,
} from '@/generated/prisma'
import { OutreachRobocallSendService } from '@/outreach/services/outreachRobocallSend.service'
import { PeerlyIdentityService } from '@/vendors/peerly/services/peerlyIdentity.service'
import { PEERLY_USECASE } from '@/vendors/peerly/services/peerly.const'
import { PeerlyCvVerificationStatus } from '@/vendors/peerly/peerly.types'
import { useTestService } from '@/test-service'

const { envNonProd, vendorMode } = vi.hoisted(() => ({
  envNonProd: { value: true },
  vendorMode: { value: 'mock' },
}))
vi.mock('@/shared/util/appEnvironment.util', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/shared/util/appEnvironment.util')>()
  return {
    ...actual,
    get IS_NON_PROD_DEPLOY() {
      return envNonProd.value
    },
    get VENDOR_MODE() {
      return vendorMode.value
    },
  }
})

const service = useTestService()

const seedCampaign = async (userId: number) => {
  const slug = `test-campaign-${Math.random().toString(36).slice(2)}`
  await service.prisma.organization.create({
    data: { slug, ownerId: userId },
  })
  return service.prisma.campaign.create({
    data: { userId, slug, organizationSlug: slug },
  })
}

const seedRecord = (
  vendor: VendorMockVendor,
  kind: string,
  externalId: string,
  state: object,
  campaignId?: number,
) =>
  service.prisma.vendorMockRecord.create({
    data: { vendor, kind, externalId, state, campaignId },
  })

const applyAction = (
  campaignId: number,
  action: string,
  params?: Record<string, unknown>,
) =>
  service.client.post(
    '/v1/test-fixtures/vendor-mocks/actions',
    { campaignId, action, params },
    { validateStatus: () => true },
  )

describe('POST /v1/test-fixtures/vendor-mocks/actions', () => {
  beforeEach(() => {
    envNonProd.value = true
  })

  it("arms a route failure scoped to the caller's campaign", async () => {
    const campaign = await seedCampaign(service.user.id)

    const res = await service.client.post(
      '/v1/test-fixtures/vendor-mocks/actions',
      { campaignId: campaign.id, action: 'geoapify.route.fail' },
      { validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.records).toEqual([
      expect.objectContaining({
        kind: 'route_fail',
        externalId: String(campaign.id),
        campaignId: campaign.id,
        state: { routeFail: true },
      }),
    ])
  })

  it('sets vb_campaign status to END for callhub.campaign.complete', async () => {
    const campaign = await seedCampaign(service.user.id)
    const outreach = await service.prisma.outreach.create({
      data: {
        outreachType: OutreachType.robocall,
        campaignId: campaign.id,
        date: new Date(),
      },
    })
    await service.prisma.outreachRobocall.create({
      data: {
        outreachId: outreach.id,
        audioKey: `audio-${outreach.id}`,
        callbackNumber: '+15551234567',
        callhubCampaignPkStr: 'pk-test-complete',
      },
    })
    await seedRecord(
      VendorMockVendor.callhub,
      'vb_campaign',
      'pk-test-complete',
      { status: 2 },
    )

    const res = await service.client.post(
      '/v1/test-fixtures/vendor-mocks/actions',
      { campaignId: campaign.id, action: 'callhub.campaign.complete' },
      { validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.CREATED)
    const vbRecord = res.data.records.find(
      (r: { kind: string }) => r.kind === 'vb_campaign',
    )
    expect(vbRecord).toBeDefined()
    expect(vbRecord.state.status).toBe(4)
  })

  it('is a no-op for callhub.campaign.complete when no robocall pk exists', async () => {
    const campaign = await seedCampaign(service.user.id)

    const res = await service.client.post(
      '/v1/test-fixtures/vendor-mocks/actions',
      { campaignId: campaign.id, action: 'callhub.campaign.complete' },
      { validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.records).toEqual([])
  })

  it('arms the next Vercel order to fail for vercel.order.fail', async () => {
    const campaign = await seedCampaign(service.user.id)

    const res = await service.client.post(
      '/v1/test-fixtures/vendor-mocks/actions',
      { campaignId: campaign.id, action: 'vercel.order.fail' },
      { validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.records).toEqual([
      expect.objectContaining({
        kind: 'order_fail',
        state: { orderFail: true },
      }),
    ])
  })

  describe('peerly 10DLC actions', () => {
    const seedPeerlyCampaign = async () => {
      const campaign = await seedCampaign(service.user.id)
      const identityId = `id-${campaign.id}`
      await seedRecord(
        VendorMockVendor.peerly,
        'identity',
        identityId,
        { identity_id: identityId },
        campaign.id,
      )
      await seedRecord(
        VendorMockVendor.peerly,
        'cv_request',
        identityId,
        { status: 'IN_REVIEW', pin: '123456', verificationId: 'v-1' },
        campaign.id,
      )
      await seedRecord(
        VendorMockVendor.peerly,
        'usecase',
        identityId,
        { status: 'PENDING' },
        campaign.id,
      )
      return campaign
    }

    const stateOf = (
      res: { data: { records: { kind: string; state: unknown }[] } },
      kind: string,
    ) => res.data.records.find((r) => r.kind === kind)?.state

    it('peerly.cv.approve sets the CV request APPROVED and keeps the PIN', async () => {
      const campaign = await seedPeerlyCampaign()

      const res = await applyAction(campaign.id, 'peerly.cv.approve')

      expect(res.status).toBe(HttpStatus.CREATED)
      expect(stateOf(res, 'cv_request')).toMatchObject({
        status: 'APPROVED',
        pin: '123456',
      })
    })

    it('peerly.cv.reject sets REJECTED with the given or a default reason', async () => {
      const campaign = await seedPeerlyCampaign()

      const withReason = await applyAction(campaign.id, 'peerly.cv.reject', {
        reason: 'Filing mismatch',
      })
      expect(stateOf(withReason, 'cv_request')).toMatchObject({
        status: 'REJECTED',
        rejectionReason: 'Filing mismatch',
      })

      const withDefault = await applyAction(campaign.id, 'peerly.cv.reject')
      expect(
        (stateOf(withDefault, 'cv_request') as { rejectionReason: string })
          .rejectionReason,
      ).toBeTruthy()
    })

    it('peerly.cv.reject rejects a non-string reason', async () => {
      const campaign = await seedPeerlyCampaign()

      const res = await applyAction(campaign.id, 'peerly.cv.reject', {
        reason: 42,
      })

      expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    })

    it('peerly.cv.setPin replaces the stored PIN with a 6-digit string', async () => {
      const campaign = await seedPeerlyCampaign()

      const res = await applyAction(campaign.id, 'peerly.cv.setPin', {
        pin: '999999',
      })

      expect(res.status).toBe(HttpStatus.CREATED)
      expect(stateOf(res, 'cv_request')).toMatchObject({
        status: 'IN_REVIEW',
        pin: '999999',
      })
    })

    it.each([undefined, '12345', '1234567', 'abc123', 123456])(
      'peerly.cv.setPin rejects pin %s',
      async (pin) => {
        const campaign = await seedPeerlyCampaign()

        const res = await applyAction(campaign.id, 'peerly.cv.setPin', {
          pin,
        })

        expect(res.status).toBe(HttpStatus.BAD_REQUEST)
      },
    )

    it('peerly.usecase.activate sets the use case ACTIVE', async () => {
      const campaign = await seedPeerlyCampaign()

      const res = await applyAction(campaign.id, 'peerly.usecase.activate')

      expect(res.status).toBe(HttpStatus.CREATED)
      expect(stateOf(res, 'usecase')).toEqual({ status: 'ACTIVE' })
    })

    it.each([
      'peerly.cv.approve',
      'peerly.cv.reject',
      'peerly.usecase.activate',
    ])(
      '%s returns 404 for a campaign with no Peerly identity',
      async (action) => {
        const campaign = await seedCampaign(service.user.id)

        const res = await applyAction(campaign.id, action)

        expect(res.status).toBe(HttpStatus.NOT_FOUND)
      },
    )
  })

  it('returns 403 when the campaign belongs to a different user', async () => {
    const otherUser = await service.prisma.user.create({
      data: {
        email: `other-${Math.random().toString(36).slice(2)}@test.goodparty.org`,
        name: 'Other',
        firstName: 'Other',
        lastName: 'User',
      },
    })
    const campaign = await seedCampaign(otherUser.id)

    const res = await service.client.post(
      '/v1/test-fixtures/vendor-mocks/actions',
      { campaignId: campaign.id, action: 'geoapify.route.fail' },
      { validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.FORBIDDEN)
  })

  it('returns 404 outside a non-prod deploy', async () => {
    envNonProd.value = false
    const campaign = await seedCampaign(service.user.id)

    const res = await service.client.post(
      '/v1/test-fixtures/vendor-mocks/actions',
      { campaignId: campaign.id, action: 'geoapify.route.fail' },
      { validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })
})

describe('GET /v1/test-fixtures/vendor-mocks/records', () => {
  beforeEach(() => {
    envNonProd.value = true
  })

  it('returns records for a campaign owned by the caller', async () => {
    const campaign = await seedCampaign(service.user.id)
    await seedRecord(
      VendorMockVendor.geoapify,
      'routeplanner_request',
      'r-1',
      { status: 'ok' },
      campaign.id,
    )
    await seedRecord(
      VendorMockVendor.geoapify,
      'routeplanner_request',
      'r-2',
      { status: 'ok' },
      campaign.id,
    )

    const res = await service.client.get(
      '/v1/test-fixtures/vendor-mocks/records',
      { params: { campaignId: campaign.id }, validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.vendorMode).toBe('mock')
    expect(res.data.records).toHaveLength(2)
    expect(
      res.data.records.every(
        (r: { externalId: string }) =>
          r.externalId === 'r-1' || r.externalId === 'r-2',
      ),
    ).toBe(true)
  })

  it('returns 403 when the campaign belongs to a different user', async () => {
    const otherUser = await service.prisma.user.create({
      data: {
        email: `other-${Math.random().toString(36).slice(2)}@test.goodparty.org`,
        name: 'Other',
        firstName: 'Other',
        lastName: 'User',
      },
    })
    const campaign = await seedCampaign(otherUser.id)

    const res = await service.client.get(
      '/v1/test-fixtures/vendor-mocks/records',
      { params: { campaignId: campaign.id }, validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.FORBIDDEN)
  })

  it('returns records stamped with an organization the caller owns', async () => {
    const campaign = await seedCampaign(service.user.id)
    const slug = campaign.organizationSlug
    await seedRecord(VendorMockVendor.geoapify, 'routeplanner_request', 'o-1', {
      status: 'complete',
      waypoints: 3,
      organizationSlug: slug,
    })
    await seedRecord(
      VendorMockVendor.geoapify,
      'routeplanner_request',
      'o-other',
      { status: 'complete', waypoints: 3, organizationSlug: 'someone-else' },
    )

    const res = await service.client.get(
      '/v1/test-fixtures/vendor-mocks/records',
      { params: { organizationSlug: slug }, validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.vendorMode).toBe('mock')
    expect(
      res.data.records.map((r: { externalId: string }) => r.externalId),
    ).toEqual(['o-1'])
  })

  it('returns 403 for an organization owned by a different user', async () => {
    const otherUser = await service.prisma.user.create({
      data: {
        email: `other-${Math.random().toString(36).slice(2)}@test.goodparty.org`,
        name: 'Other',
        firstName: 'Other',
        lastName: 'User',
      },
    })
    const campaign = await seedCampaign(otherUser.id)

    const res = await service.client.get(
      '/v1/test-fixtures/vendor-mocks/records',
      {
        params: { organizationSlug: campaign.organizationSlug },
        validateStatus: () => true,
      },
    )

    expect(res.status).toBe(HttpStatus.FORBIDDEN)
  })

  it('returns 400 unless exactly one of campaignId or organizationSlug is given', async () => {
    const res = await service.client.get(
      '/v1/test-fixtures/vendor-mocks/records',
      { validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('returns 404 for an organization lookup outside a non-prod deploy', async () => {
    envNonProd.value = false
    const campaign = await seedCampaign(service.user.id)

    const res = await service.client.get(
      '/v1/test-fixtures/vendor-mocks/records',
      {
        params: { organizationSlug: campaign.organizationSlug },
        validateStatus: () => true,
      },
    )

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })

  it('returns 404 outside a non-prod deploy', async () => {
    envNonProd.value = false
    const campaign = await seedCampaign(service.user.id)

    const res = await service.client.get(
      '/v1/test-fixtures/vendor-mocks/records',
      { params: { campaignId: campaign.id }, validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })
})

describe('POST /v1/test-fixtures/jobs/:name/run', () => {
  beforeEach(async () => {
    envNonProd.value = true
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { roles: [UserRole.admin] },
    })
  })

  it('returns 404 for any job name (M1 allowlist is empty)', async () => {
    const res = await service.client.post(
      '/v1/test-fixtures/jobs/some-job/run',
      {},
      { validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })

  it('404s outside a non-prod deploy', async () => {
    envNonProd.value = false

    const res = await service.client.post(
      '/v1/test-fixtures/jobs/any-job/run',
      {},
      { validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })
})

describe('POST /v1/test-fixtures/vendor-mocks/jobs/:name/run', () => {
  beforeEach(async () => {
    envNonProd.value = true
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { email: 'qa-00000000-0000-0000-0000-000000000000@goodparty.org' },
    })
  })

  it('returns 404 for an unknown job name', async () => {
    const res = await service.client.post(
      '/v1/test-fixtures/vendor-mocks/jobs/unknown-job/run',
      {},
      { validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })

  it('returns 403 for a non-test user', async () => {
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { email: 'nottest@goodparty.org' },
    })

    const res = await service.client.post(
      '/v1/test-fixtures/vendor-mocks/jobs/robocall.staging/run',
      {},
      { validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.FORBIDDEN)
  })

  it('returns 404 outside a non-prod deploy', async () => {
    envNonProd.value = false

    const res = await service.client.post(
      '/v1/test-fixtures/vendor-mocks/jobs/robocall.staging/run',
      {},
      { validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })
})

describe('POST /v1/test-fixtures/vendor-mocks/jobs/robocall.send/run', () => {
  beforeEach(async () => {
    envNonProd.value = true
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { email: 'qa-00000000-0000-0000-0000-000000000000@goodparty.org' },
    })
  })

  const spies: { mockRestore: () => void }[] = []
  afterEach(() => {
    spies.splice(0).forEach((spy) => spy.mockRestore())
  })

  const seedRobocall = async (
    campaignId: number,
    date: Date,
    data: Record<string, unknown>,
  ) => {
    const outreach = await service.prisma.outreach.create({
      data: { outreachType: OutreachType.robocall, campaignId, date },
    })
    await service.prisma.outreachRobocall.create({
      data: {
        outreachId: outreach.id,
        audioKey: `audio-${outreach.id}`,
        callbackNumber: '+15551234567',
        callhubCampaignPkStr: `pk-${outreach.id}`,
        ...data,
      },
    })
    return outreach
  }

  it("launches the caller's due run past another user's leftovers", async () => {
    const other = await service.prisma.user.create({
      data: {
        email: `other-${Date.now()}@example.com`,
        clerkId: `user_other_${Date.now()}`,
        firstName: 'Other',
        lastName: 'User',
      },
    })
    const otherCampaign = await seedCampaign(other.id)
    const longAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
    await seedRobocall(otherCampaign.id, longAgo, {
      settleState: RobocallSettleState.dialed,
      dialedAt: new Date(),
      billableCount: 100,
    })
    await seedRobocall(otherCampaign.id, longAgo, {
      settleState: RobocallSettleState.authorized,
    })
    const campaign = await seedCampaign(service.user.id)
    const mine = await seedRobocall(
      campaign.id,
      new Date(Date.now() - 60 * 1000),
      { settleState: RobocallSettleState.authorized },
    )
    const startCampaign = vi
      .spyOn(service.app.get(OutreachRobocallSendService), 'startCampaign')
      .mockResolvedValue('done')
    spies.push(startCampaign)

    const res = await service.client.post(
      '/v1/test-fixtures/vendor-mocks/jobs/robocall.send/run',
      {},
      { validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(startCampaign.mock.calls).toEqual([[mine.id]])
  })
})

describe('POST /v1/test-fixtures/vendor-mocks/jobs/:name/run (10DLC jobs)', () => {
  const runJob = (name: string) =>
    service.client.post(
      `/v1/test-fixtures/vendor-mocks/jobs/${name}/run`,
      {},
      { validateStatus: () => true },
    )

  const seedTcr = async (campaignId: number, data: Record<string, unknown>) =>
    service.prisma.tcrCompliance.create({
      data: {
        campaignId,
        ein: '12-3456789',
        postalAddress: '1 Main St',
        committeeName: 'Fixture Committee',
        websiteDomain: 'example.com',
        filingUrl: 'https://example.com/filing',
        phone: '5555555555',
        email: 'fixture@example.com',
        officeLevel: OfficeLevel.local,
        peerlyIdentityId: `peerly-${Math.random().toString(36).slice(2)}`,
        ...data,
      },
    })

  beforeEach(async () => {
    envNonProd.value = true
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { email: 'qa-00000000-0000-0000-0000-000000000000@goodparty.org' },
    })
  })

  // Restore only this suite's spies; vi.restoreAllMocks() would also undo the
  // harness's auth-provider mocks and 401 every later test.
  const spies: { mockRestore: () => void }[] = []
  afterEach(() => {
    spies.splice(0).forEach((spy) => spy.mockRestore())
  })

  it("cvStatusPoll.scanFresh polls only the caller's fresh record", async () => {
    const campaign = await seedCampaign(service.user.id)
    const record = await seedTcr(campaign.id, {
      status: TcrComplianceStatus.submitted,
      peerlySubmissionStartedAt: new Date(),
    })
    const peerly = service.app.get(PeerlyIdentityService)
    const retrieve = vi
      .spyOn(peerly, 'retrieveCampaignVerifyDetails')
      .mockResolvedValue({
        status: PeerlyCvVerificationStatus.IN_REVIEW,
        pinDelivery: null,
      } as never)
    spies.push(retrieve)

    const res = await runJob('cvStatusPoll.scanFresh')

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data).toEqual({
      ranAt: expect.any(String),
      durationMs: expect.any(Number),
    })
    expect(retrieve).toHaveBeenCalledTimes(1)
    expect(retrieve.mock.calls[0]?.[0]).toBe(record.peerlyIdentityId)
    const updated = await service.prisma.tcrCompliance.findUniqueOrThrow({
      where: { id: record.id },
    })
    expect(updated.peerlyCvStatus).toBe(PeerlyCvVerificationStatus.IN_REVIEW)
  })

  it('tcr.usecaseSweep runs twice in the same hour', async () => {
    const first = await runJob('tcr.usecaseSweep')
    const second = await runJob('tcr.usecaseSweep')

    expect(first.status).toBe(HttpStatus.CREATED)
    expect(second.status).toBe(HttpStatus.CREATED)
  })

  it("tcr.complianceSweep approves the caller's pending record without SQS", async () => {
    const campaign = await seedCampaign(service.user.id)
    const record = await seedTcr(campaign.id, {
      status: TcrComplianceStatus.pending,
      peerlyCvStatus: PeerlyCvVerificationStatus.VERIFIED,
    })
    spies.push(
      vi
        .spyOn(service.app.get(PeerlyIdentityService), 'getIdentityUseCases')
        .mockResolvedValue([
          { usecase: PEERLY_USECASE, activated: true },
        ] as never),
    )

    const res = await runJob('tcr.complianceSweep')

    expect(res.status).toBe(HttpStatus.CREATED)
    const updated = await service.prisma.tcrCompliance.findUniqueOrThrow({
      where: { id: record.id },
    })
    expect(updated.status).toBe(TcrComplianceStatus.approved)
  })

  it('tcr.complianceSweep 404s when the caller has no pending record', async () => {
    await seedCampaign(service.user.id)

    const res = await runJob('tcr.complianceSweep')

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })
})

describe('POST /v1/test-fixtures/vendor-mocks/time-travel', () => {
  beforeEach(() => {
    envNonProd.value = true
  })

  const seedOutreach = async (userId: number, withRobocall = false) => {
    const campaign = await seedCampaign(userId)
    const outreach = await service.prisma.outreach.create({
      data: {
        outreachType: OutreachType.robocall,
        campaignId: campaign.id,
        date: new Date('2026-01-01T12:00:00Z'),
      },
    })
    if (withRobocall) {
      await service.prisma.outreachRobocall.create({
        data: {
          outreachId: outreach.id,
          audioKey: `audio-${outreach.id}`,
          callbackNumber: '+15551234567',
        },
      })
    }
    return { campaign, outreach }
  }

  it('sets date to 1 minute ago for robocall.send_due_now', async () => {
    const { outreach } = await seedOutreach(service.user.id)
    const before = new Date()

    const res = await service.client.post(
      '/v1/test-fixtures/vendor-mocks/time-travel',
      { outreachId: outreach.id, action: 'robocall.send_due_now' },
      { validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.outreachId).toBe(outreach.id)
    const date = new Date(res.data.date)
    const oneMinuteAgo = before.getTime() - 60_000
    expect(date.getTime()).toBeGreaterThanOrEqual(oneMinuteAgo - 2000)
    expect(date.getTime()).toBeLessThanOrEqual(oneMinuteAgo + 2000)
    expect(res.data.dialedAt).toBeNull()
    expect(res.data.poolFreedAt).toBeNull()
  })

  it('backdates dialedAt and leaves null poolFreedAt null', async () => {
    const { outreach } = await seedOutreach(service.user.id, true)
    const before = new Date()

    const res = await service.client.post(
      '/v1/test-fixtures/vendor-mocks/time-travel',
      { outreachId: outreach.id, action: 'robocall.dialed_48h_ago' },
      { validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.CREATED)
    const dialedAt = new Date(res.data.dialedAt)
    expect(before.getTime() - dialedAt.getTime()).toBeGreaterThan(
      48 * 60 * 60 * 1000,
    )
    expect(res.data.poolFreedAt).toBeNull()
  })

  it('backdates both dialedAt and poolFreedAt when poolFreedAt is non-null', async () => {
    const { outreach } = await seedOutreach(service.user.id, true)
    const priorPoolFreedAt = new Date('2026-01-01T00:00:00Z')
    await service.prisma.outreachRobocall.update({
      where: { outreachId: outreach.id },
      data: { poolFreedAt: priorPoolFreedAt },
    })
    const before = new Date()

    const res = await service.client.post(
      '/v1/test-fixtures/vendor-mocks/time-travel',
      { outreachId: outreach.id, action: 'robocall.dialed_48h_ago' },
      { validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.CREATED)
    const dialedAt = new Date(res.data.dialedAt)
    expect(before.getTime() - dialedAt.getTime()).toBeGreaterThan(
      48 * 60 * 60 * 1000,
    )
    expect(res.data.poolFreedAt).toBe(res.data.dialedAt)
  })

  it('returns 403 when the outreach belongs to a different campaign owner', async () => {
    const otherUser = await service.prisma.user.create({
      data: {
        email: `other-${Math.random().toString(36).slice(2)}@test.goodparty.org`,
        name: 'Other',
        firstName: 'Other',
        lastName: 'User',
      },
    })
    const { outreach } = await seedOutreach(otherUser.id)

    const res = await service.client.post(
      '/v1/test-fixtures/vendor-mocks/time-travel',
      { outreachId: outreach.id, action: 'robocall.send_due_now' },
      { validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.FORBIDDEN)
  })

  it('returns 404 for a missing outreach', async () => {
    const res = await service.client.post(
      '/v1/test-fixtures/vendor-mocks/time-travel',
      { outreachId: 999999, action: 'robocall.send_due_now' },
      { validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })

  it('returns 400 for sms.start_date_today (not yet implemented)', async () => {
    const { outreach } = await seedOutreach(service.user.id)

    const res = await service.client.post(
      '/v1/test-fixtures/vendor-mocks/time-travel',
      { outreachId: outreach.id, action: 'sms.start_date_today' },
      { validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('returns 404 outside a non-prod deploy', async () => {
    envNonProd.value = false
    const { outreach } = await seedOutreach(service.user.id)

    const res = await service.client.post(
      '/v1/test-fixtures/vendor-mocks/time-travel',
      { outreachId: outreach.id, action: 'robocall.send_due_now' },
      { validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })
})

describe('POST /v1/test-fixtures/vendor-mocks/cv-validation/override', () => {
  const OVERRIDE_ROUTE = '/v1/test-fixtures/vendor-mocks/cv-validation/override'

  const seedTcr = (campaignId: number) =>
    service.prisma.tcrCompliance.create({
      data: {
        campaignId,
        ein: '12-3456789',
        postalAddress: '1 Main St',
        committeeName: 'Fixture Committee',
        websiteDomain: 'example.com',
        filingUrl: 'https://example.com/filing',
        phone: '5555555555',
        email: 'fixture@example.com',
        officeLevel: OfficeLevel.local,
      },
    })

  const overriddenAt = async (campaignId: number) =>
    (
      await service.prisma.tcrCompliance.findUniqueOrThrow({
        where: { campaignId },
      })
    ).cvValidationOverriddenAt

  beforeEach(async () => {
    envNonProd.value = true
    vendorMode.value = 'mock'
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { email: 'qa-00000000-0000-0000-0000-000000000000@goodparty.org' },
    })
  })

  it("stamps the caller's own TcrCompliance record in mock mode", async () => {
    const campaign = await seedCampaign(service.user.id)
    await seedTcr(campaign.id)

    const res = await service.client.post(
      OVERRIDE_ROUTE,
      {},
      { validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.NO_CONTENT)
    expect(await overriddenAt(campaign.id)).toBeInstanceOf(Date)
  })

  it("leaves another user's campaign untouched", async () => {
    const campaign = await seedCampaign(service.user.id)
    await seedTcr(campaign.id)
    const otherUser = await service.prisma.user.create({
      data: { email: `other-${Math.random()}@test.goodparty.org` },
    })
    const other = await seedCampaign(otherUser.id)
    await seedTcr(other.id)

    await service.client.post(
      OVERRIDE_ROUTE,
      {},
      { validateStatus: () => true },
    )

    expect(await overriddenAt(campaign.id)).toBeInstanceOf(Date)
    expect(await overriddenAt(other.id)).toBeNull()
  })

  it('403s for a non-test user and writes nothing', async () => {
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { email: 'real@example.com' },
    })
    const campaign = await seedCampaign(service.user.id)
    await seedTcr(campaign.id)

    const res = await service.client.post(
      OVERRIDE_ROUTE,
      {},
      { validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.FORBIDDEN)
    expect(await overriddenAt(campaign.id)).toBeNull()
  })

  it('404s in live mode and writes nothing', async () => {
    vendorMode.value = 'live'
    const campaign = await seedCampaign(service.user.id)
    await seedTcr(campaign.id)

    const res = await service.client.post(
      OVERRIDE_ROUTE,
      {},
      { validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
    expect(await overriddenAt(campaign.id)).toBeNull()
  })

  it('404s on a prod deploy', async () => {
    envNonProd.value = false
    const campaign = await seedCampaign(service.user.id)
    await seedTcr(campaign.id)

    const res = await service.client.post(
      OVERRIDE_ROUTE,
      {},
      { validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
    expect(await overriddenAt(campaign.id)).toBeNull()
  })
})

describe('POST /v1/test-fixtures/vendor-mocks/outreach/:id/admin-actions', () => {
  beforeEach(async () => {
    envNonProd.value = true
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: {
        email: 'qa-00000000-0000-0000-0000-000000000000@goodparty.org',
      },
    })
  })

  const seedServeOrg = async (userId: number) => {
    const slug = `eo-test-${Math.random().toString(36).slice(2)}`
    await service.prisma.organization.create({
      data: { slug, ownerId: userId },
    })
    return slug
  }

  it('returns 403 when the serve outreach belongs to another org owner', async () => {
    const otherUser = await service.prisma.user.create({
      data: {
        email: `other-${Math.random().toString(36).slice(2)}@test.goodparty.org`,
        name: 'Other',
        firstName: 'Other',
        lastName: 'User',
      },
    })
    const slug = await seedServeOrg(otherUser.id)
    const outreach = await service.prisma.outreach.create({
      data: {
        outreachType: OutreachType.text,
        organizationSlug: slug,
        date: new Date(),
      },
    })

    const res = await service.client.post(
      `/v1/test-fixtures/vendor-mocks/outreach/${outreach.id}/admin-actions`,
      { action: 'results.upload' },
      { validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.FORBIDDEN)
  })

  it('returns 404 for a non-existent outreach', async () => {
    const res = await service.client.post(
      '/v1/test-fixtures/vendor-mocks/outreach/999999/admin-actions',
      { action: 'results.upload' },
      { validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })

  it('passes ownership check for a serve outreach owned by the caller', async () => {
    const slug = await seedServeOrg(service.user.id)
    const outreach = await service.prisma.outreach.create({
      data: {
        outreachType: OutreachType.text,
        organizationSlug: slug,
        date: new Date(),
      },
    })

    // results.upload requires a CSV string payload; passing a
    // non-string exercises the ownership guard (which must pass)
    // and then surfaces a 400 from the action itself, proving the
    // 404-on-serve-outreach bug is fixed.
    const res = await service.client.post(
      `/v1/test-fixtures/vendor-mocks/outreach/${outreach.id}/admin-actions`,
      { action: 'results.upload' },
      { validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('lets a non-test user act on a serve outreach they own', async () => {
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { email: 'demo-official@goodparty.org' },
    })
    const slug = await seedServeOrg(service.user.id)
    const outreach = await service.prisma.outreach.create({
      data: {
        outreachType: OutreachType.text,
        organizationSlug: slug,
        date: new Date(),
      },
    })

    const res = await service.client.post(
      `/v1/test-fixtures/vendor-mocks/outreach/${outreach.id}/admin-actions`,
      { action: 'results.upload' },
      { validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it("returns 403 for a non-test user on another user's campaign outreach", async () => {
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { email: 'demo-official@goodparty.org' },
    })
    const otherUser = await service.prisma.user.create({
      data: {
        email: `other-${Math.random().toString(36).slice(2)}@test.goodparty.org`,
      },
    })
    const campaign = await seedCampaign(otherUser.id)
    const outreach = await service.prisma.outreach.create({
      data: {
        outreachType: OutreachType.text,
        campaignId: campaign.id,
        date: new Date(),
      },
    })

    const res = await service.client.post(
      `/v1/test-fixtures/vendor-mocks/outreach/${outreach.id}/admin-actions`,
      { action: 'results.upload' },
      { validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.FORBIDDEN)
  })

  it('returns 404 outside a non-prod deploy', async () => {
    envNonProd.value = false
    const slug = await seedServeOrg(service.user.id)
    const outreach = await service.prisma.outreach.create({
      data: {
        outreachType: OutreachType.text,
        organizationSlug: slug,
        date: new Date(),
      },
    })

    const res = await service.client.post(
      `/v1/test-fixtures/vendor-mocks/outreach/${outreach.id}/admin-actions`,
      { action: 'results.upload' },
      { validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })

  it('returns 400 when {{recipient:N}} placeholders exceed recipients', async () => {
    const slug = await seedServeOrg(service.user.id)
    const outreach = await service.prisma.outreach.create({
      data: {
        outreachType: OutreachType.text,
        organizationSlug: slug,
        status: OutreachStatus.in_progress,
        date: new Date(),
      },
    })
    // No OutreachTextRecipient rows — placeholder resolution must fail.

    const res = await service.client.post(
      `/v1/test-fixtures/vendor-mocks/outreach/${outreach.id}/admin-actions`,
      {
        action: 'results.upload',
        payload: 'phone,message,direction\n{{recipient:0}},Hi,INBOUND',
      },
      { validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
  })
})
