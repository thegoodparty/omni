import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { PeerlyP2pJobService } from '@/vendors/peerly/services/peerlyP2pJob.service'
import { StripeService } from '@/vendors/stripe/services/stripe.service'
import { OutreachStatus, OutreachType } from '../../generated/prisma'

const service = useTestService()

const updateJobStatus = vi.fn()
const retrieveCheckoutSession = vi.fn()
const refundPaymentIntent = vi.fn()

let orgSlug: string
let campaignId: number

beforeEach(async () => {
  // clearMocks resets calls, not implementations — a persistent
  // mockRejectedValue from one test must not leak into the next.
  updateJobStatus.mockReset().mockResolvedValue(undefined)
  retrieveCheckoutSession.mockReset()
  refundPaymentIntent.mockReset()

  const peerly = service.app.get(PeerlyP2pJobService)
  vi.spyOn(peerly, 'updateJobStatus').mockImplementation(updateJobStatus)
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
    projectId: string | null
    stripeCheckoutSessionId: string | null
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
    expect(updateJobStatus).toHaveBeenCalledWith('peerly-job-1', 'deleted')
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
    expect(updateJobStatus).not.toHaveBeenCalled()
  })

  it('is idempotent: canceling a canceled row is a no-op', async () => {
    retrieveCheckoutSession.mockResolvedValue({ payment_intent: 'pi_test_1' })
    refundPaymentIntent.mockResolvedValue({ id: 're_1' })
    const row = await seedOutreach()

    await postCancel(row.id)
    const second = await postCancel(row.id)

    expect(second.status).toBe(HttpStatus.CREATED)
    expect(second.data.refunded).toBe(false)
    expect(updateJobStatus).toHaveBeenCalledTimes(1)
    expect(refundPaymentIntent).toHaveBeenCalledTimes(1)
  })

  it('aborts untouched when the vendor delete fails', async () => {
    updateJobStatus.mockRejectedValue(new Error('peerly down'))
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
