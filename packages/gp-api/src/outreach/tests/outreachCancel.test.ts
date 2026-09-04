import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { PeerlyP2pJobService } from '@/vendors/peerly/services/peerlyP2pJob.service'
import { StripeService } from '@/vendors/stripe/services/stripe.service'
import { OutreachStatus, OutreachType } from '../../generated/prisma'

const service = useTestService()

const deleteJob = vi.fn()
const retrieveCheckoutSession = vi.fn()
const refundPaymentIntent = vi.fn()

let orgSlug: string
let campaignId: number

beforeEach(async () => {
  // clearMocks resets calls, not implementations — a persistent
  // mockRejectedValue from one test must not leak into the next.
  deleteJob.mockReset().mockResolvedValue(undefined)
  retrieveCheckoutSession.mockReset()
  refundPaymentIntent.mockReset()

  const peerly = service.app.get(PeerlyP2pJobService)
  vi.spyOn(peerly, 'deleteJob').mockImplementation(deleteJob)
  const stripe = service.app.get(StripeService)
  vi.spyOn(stripe, 'retrieveCheckoutSession').mockImplementation(
    retrieveCheckoutSession,
  )
  vi.spyOn(stripe, 'refundPaymentIntent').mockImplementation(
    refundPaymentIntent,
  )

  campaignId = 997
  orgSlug = `campaign-${campaignId}`

  await service.prisma.organization.create({
    data: { slug: orgSlug, ownerId: service.user.id, positionId: 'pos-1' },
  })
  await service.prisma.campaign.create({
    data: {
      id: campaignId,
      organizationSlug: orgSlug,
      userId: service.user.id,
      slug: 'jane-doe-cancel',
      details: { state: 'TX', zip: '78634' },
      data: {},
      aiContent: {},
    },
  })
})

const seedOutreach = (
  overrides: Partial<{
    status: OutreachStatus
    outreachType: OutreachType
    projectId: string | null
    stripeCheckoutSessionId: string | null
    date: Date
    textCount: number | null
    billableTextCount: number | null
  }> = {},
) =>
  service.prisma.outreach.create({
    data: {
      campaignId,
      outreachType: OutreachType.p2p,
      name: 'Likely voters — SMS',
      status: OutreachStatus.pending,
      projectId: 'peerly-job-1',
      stripeCheckoutSessionId: 'cs_test_123',
      ...overrides,
    },
  })

const postCancel = (id: number) =>
  service.client.post(
    `/v1/outreach/${id}/cancel`,
    {},
    { headers: { 'x-organization-slug': orgSlug } },
  )

describe('POST /v1/outreach/:id/cancel', () => {
  it('deletes the vendor job, refunds, and flips the row to canceled', async () => {
    retrieveCheckoutSession.mockResolvedValue({ payment_intent: 'pi_test_1' })
    refundPaymentIntent.mockResolvedValue({ id: 're_1' })
    const row = await seedOutreach()

    const res = await postCancel(row.id)

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.refunded).toBe(true)
    expect(res.data.outreach.status).toBe('canceled')
    expect(deleteJob).toHaveBeenCalledWith('peerly-job-1')
    expect(refundPaymentIntent).toHaveBeenCalledWith(
      'pi_test_1',
      `outreach-cancel-${row.id}`,
    )
    const persisted = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: row.id },
    })
    expect(persisted.status).toBe(OutreachStatus.canceled)
  })

  it('cancels a free-texts campaign without touching Stripe', async () => {
    const row = await seedOutreach({ stripeCheckoutSessionId: null })

    const res = await postCancel(row.id)

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.refunded).toBe(false)
    expect(retrieveCheckoutSession).not.toHaveBeenCalled()
    expect(refundPaymentIntent).not.toHaveBeenCalled()
  })

  it('rejects rows that are not scheduled', async () => {
    const row = await seedOutreach({ status: OutreachStatus.completed })

    const res = await postCancel(row.id)

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(deleteJob).not.toHaveBeenCalled()
  })

  it('restores the free-texts offer when the canceled send consumed it', async () => {
    await service.prisma.campaign.update({
      where: { id: campaignId },
      data: {
        hasFreeTextsOffer: false,
        freeTextsOfferRedeemedAt: new Date(),
      },
    })
    const row = await seedOutreach({
      stripeCheckoutSessionId: null,
      textCount: 1780,
      billableTextCount: 0,
    })

    const res = await postCancel(row.id)
    expect(res.status).toBe(HttpStatus.CREATED)

    const campaign = await service.prisma.campaign.findFirstOrThrow({
      where: { id: campaignId },
    })
    expect(campaign.hasFreeTextsOffer).toBe(true)
    expect(campaign.freeTextsOfferRedeemedAt).toBeNull()
  })

  it('restores the offer on a partial-subsidy cancel too', async () => {
    // 5,000 promo texts + a paid remainder: the paid part is refunded by
    // the Stripe path and the never-delivered promo comes back — product
    // decision 2026-09-03 (cancel before send returns the whole benefit).
    await service.prisma.campaign.update({
      where: { id: campaignId },
      data: {
        hasFreeTextsOffer: false,
        freeTextsOfferRedeemedAt: new Date(),
      },
    })
    const row = await seedOutreach({
      stripeCheckoutSessionId: null,
      textCount: 7000,
      billableTextCount: 2000,
    })

    const res = await postCancel(row.id)
    expect(res.status).toBe(HttpStatus.CREATED)

    const campaign = await service.prisma.campaign.findFirstOrThrow({
      where: { id: campaignId },
    })
    expect(campaign.hasFreeTextsOffer).toBe(true)
    expect(campaign.freeTextsOfferRedeemedAt).toBeNull()
  })

  it('does not restore the offer for a full-price cancel', async () => {
    await service.prisma.campaign.update({
      where: { id: campaignId },
      data: {
        hasFreeTextsOffer: false,
        freeTextsOfferRedeemedAt: new Date(),
      },
    })
    const row = await seedOutreach({
      stripeCheckoutSessionId: null,
      textCount: 1200,
      billableTextCount: 1200,
    })

    const res = await postCancel(row.id)
    expect(res.status).toBe(HttpStatus.CREATED)

    const campaign = await service.prisma.campaign.findFirstOrThrow({
      where: { id: campaignId },
    })
    expect(campaign.hasFreeTextsOffer).toBe(false)
    expect(campaign.freeTextsOfferRedeemedAt).not.toBeNull()
  })

  it('rejects a cancel at or past the scheduled send time (launch switch on)', async () => {
    vi.stubEnv('SMS_COMPLIANCE_V2_ENABLED', 'true')
    const row = await seedOutreach({
      date: new Date(Date.now() - 60_000),
    })
    const res = await postCancel(row.id)
    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    const unchanged = await service.prisma.outreach.findFirstOrThrow({
      where: { id: row.id },
    })
    expect(unchanged.status).toBe(OutreachStatus.pending)
    vi.unstubAllEnvs()
  })

  it('rejects canceling a robocall (lifecycle runs off the satellite)', async () => {
    // A robocall reads `pending` once its hold commits, but its dial/capture is
    // driven by the satellite settleState, so canceling here would desync the
    // spine without voiding the hold or stopping the dial.
    const row = await seedOutreach({
      outreachType: OutreachType.robocall,
      projectId: null,
      stripeCheckoutSessionId: null,
    })

    const res = await postCancel(row.id)

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(deleteJob).not.toHaveBeenCalled()
    const persisted = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: row.id },
    })
    expect(persisted.status).toBe(OutreachStatus.pending)
  })

  it('is idempotent: canceling a canceled row is a no-op', async () => {
    retrieveCheckoutSession.mockResolvedValue({ payment_intent: 'pi_test_1' })
    refundPaymentIntent.mockResolvedValue({ id: 're_1' })
    const row = await seedOutreach()

    await postCancel(row.id)
    const second = await postCancel(row.id)

    expect(second.status).toBe(HttpStatus.CREATED)
    expect(second.data.refunded).toBe(false)
    expect(deleteJob).toHaveBeenCalledTimes(1)
    expect(refundPaymentIntent).toHaveBeenCalledTimes(1)
  })

  it('aborts untouched when the vendor delete fails', async () => {
    deleteJob.mockRejectedValue(new Error('peerly down'))
    const row = await seedOutreach()

    const res = await postCancel(row.id)

    expect(res.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR)
    expect(refundPaymentIntent).not.toHaveBeenCalled()
    const persisted = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: row.id },
    })
    expect(persisted.status).toBe(OutreachStatus.pending)
  })

  it('leaves the row pending when the refund fails, so cancel can retry', async () => {
    retrieveCheckoutSession.mockResolvedValue({ payment_intent: 'pi_test_1' })
    refundPaymentIntent.mockRejectedValue(new Error('stripe down'))
    const row = await seedOutreach()

    const res = await postCancel(row.id)

    expect(res.status).toBe(HttpStatus.BAD_GATEWAY)
    const persisted = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: row.id },
    })
    expect(persisted.status).toBe(OutreachStatus.pending)
  })

  it("404s another campaign's outreach", async () => {
    const foreignCampaignId = 996
    await service.prisma.organization.create({
      data: {
        slug: `campaign-${foreignCampaignId}`,
        ownerId: service.user.id,
        positionId: 'pos-2',
      },
    })
    await service.prisma.campaign.create({
      data: {
        id: foreignCampaignId,
        organizationSlug: `campaign-${foreignCampaignId}`,
        userId: service.user.id,
        slug: 'other-campaign',
        details: {},
        data: {},
        aiContent: {},
      },
    })
    const row = await service.prisma.outreach.create({
      data: {
        campaignId: foreignCampaignId,
        outreachType: OutreachType.p2p,
        status: OutreachStatus.pending,
      },
    })

    const res = await postCancel(row.id)

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })
})
