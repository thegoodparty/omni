import { ConflictException } from '@nestjs/common'
import { addHours } from 'date-fns'
import type Stripe from 'stripe'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { OutreachSmsAdminService } from '@/outreach/services/outreachSmsAdmin.service'
import { StripeService } from '@/vendors/stripe/services/stripe.service'
import { PeerlyP2pJobService } from '@/vendors/peerly/services/peerlyP2pJob.service'
import {
  Campaign,
  OutreachStatus,
  P2pSmsSettleState,
} from '../../generated/prisma'

const service = useTestService()

let admin: OutreachSmsAdminService
let retrieveSpy: ReturnType<typeof vi.spyOn>
let refundChargeSpy: ReturnType<typeof vi.spyOn>
let voidSpy: ReturnType<typeof vi.spyOn>
let deleteJobSpy: ReturnType<typeof vi.spyOn>

let campaign: Campaign
let orgSlug: string
let filterId: number

const INTENT_ID = 'pi_deny_1'
const CHARGE_ID = 'ch_deny_1'

// retrievePaymentIntent returns the full Stripe.Response<PaymentIntent>; the
// release only reads status + latest_charge.
const mockIntent = (
  overrides: Partial<Stripe.PaymentIntent> = {},
): Stripe.Response<Stripe.PaymentIntent> =>
  ({
    id: INTENT_ID,
    object: 'payment_intent',
    status: 'requires_capture',
    amount: 5000,
    latest_charge: CHARGE_ID,
    ...overrides,
  }) as unknown as Stripe.Response<Stripe.PaymentIntent>

beforeEach(async () => {
  vi.stubEnv('WIN_SMS_HOLD_BILLING', 'true')
  admin = service.app.get(OutreachSmsAdminService)

  const stripe = service.app.get(StripeService)
  retrieveSpy = vi
    .spyOn(stripe, 'retrievePaymentIntent')
    .mockResolvedValue(mockIntent())
  refundChargeSpy = vi
    .spyOn(stripe, 'refundCharge')
    .mockResolvedValue({} as Stripe.Response<Stripe.Refund>)
  voidSpy = vi.spyOn(stripe, 'voidHold').mockResolvedValue(undefined)
  deleteJobSpy = vi
    .spyOn(service.app.get(PeerlyP2pJobService), 'deleteJob')
    .mockResolvedValue(undefined)

  const campaignId = 8800
  orgSlug = `campaign-${campaignId}`
  await service.prisma.organization.create({
    data: { slug: orgSlug, ownerId: service.user.id, positionId: 'pos-1' },
  })
  campaign = await service.prisma.campaign.create({
    data: {
      id: campaignId,
      organizationSlug: orgSlug,
      userId: service.user.id,
      slug: 'hold-deny-me',
      isPro: true,
      details: {},
      data: {},
      aiContent: {},
    },
  })
  const filter = await service.prisma.voterFileFilter.create({
    data: { organizationSlug: orgSlug },
  })
  filterId = filter.id
})

const createRow = async ({
  settleState,
  withSatellite = true,
  chargeIntentId = null as string | null,
  spineStatus = OutreachStatus.pending,
}: {
  settleState?: P2pSmsSettleState
  withSatellite?: boolean
  chargeIntentId?: string | null
  spineStatus?: OutreachStatus
}): Promise<number> => {
  const spine = await service.prisma.outreach.create({
    data: {
      campaignId: campaign.id,
      organizationSlug: orgSlug,
      outreachType: 'p2p',
      status: spineStatus,
      date: addHours(new Date(), 72),
      voterFileFilterId: filterId,
      projectId: 'peerly-deny-job',
      stripeCheckoutSessionId: 'cs_paid_deny',
    },
  })
  if (withSatellite && settleState) {
    await service.prisma.outreachP2pSms.create({
      data: {
        outreachId: spine.id,
        settleState,
        authorizationIntentId: INTENT_ID,
        authorizedAmountInCents: 5000,
        chargeIntentId,
      },
    })
  }
  return spine.id
}

const readSatellite = (outreachId: number) =>
  service.prisma.outreachP2pSms.findFirstOrThrow({ where: { outreachId } })
const readSpine = (outreachId: number) =>
  service.prisma.outreach.findUniqueOrThrow({ where: { id: outreachId } })

describe('OutreachSmsAdminService.deny', () => {
  it('refunds and neutralizes the job when a captured hold is denied', async () => {
    retrieveSpy.mockResolvedValue(mockIntent({ status: 'succeeded' }))
    const outreachId = await createRow({
      settleState: P2pSmsSettleState.captured,
      chargeIntentId: CHARGE_ID,
    })

    await admin.deny(outreachId, {
      deniedBy: 'cas@gp.org',
      reason: 'off topic',
    })

    expect(refundChargeSpy).toHaveBeenCalledWith(
      CHARGE_ID,
      `p2p-sms-refund-${CHARGE_ID}`,
    )
    expect(deleteJobSpy).toHaveBeenCalledWith('peerly-deny-job')
    expect((await readSatellite(outreachId)).settleState).toBe(
      P2pSmsSettleState.refunded,
    )
    const spine = await readSpine(outreachId)
    expect(spine.deniedAt).not.toBeNull()
    expect(spine.deniedBy).toBe('cas@gp.org')
    expect(spine.deniedReason).toBe('off topic')
  })

  it('voids the hold when an authorized hold is denied', async () => {
    retrieveSpy.mockResolvedValue(mockIntent({ status: 'requires_capture' }))
    const outreachId = await createRow({
      settleState: P2pSmsSettleState.authorized,
    })

    await admin.deny(outreachId, { deniedBy: 'cas@gp.org', reason: 'bad' })

    expect(voidSpy).toHaveBeenCalledWith(INTENT_ID)
    expect(refundChargeSpy).not.toHaveBeenCalled()
    expect(deleteJobSpy).toHaveBeenCalledWith('peerly-deny-job')
    expect((await readSatellite(outreachId)).settleState).toBe(
      P2pSmsSettleState.voided,
    )
    expect((await readSpine(outreachId)).deniedAt).not.toBeNull()
  })

  it('refuses to deny a completed (sent) hold row and moves no money', async () => {
    retrieveSpy.mockResolvedValue(mockIntent({ status: 'succeeded' }))
    const outreachId = await createRow({
      settleState: P2pSmsSettleState.captured,
      chargeIntentId: CHARGE_ID,
      spineStatus: OutreachStatus.completed,
    })

    await expect(
      admin.deny(outreachId, { deniedBy: 'cas@gp.org', reason: 'late' }),
    ).rejects.toBeInstanceOf(ConflictException)
    expect(refundChargeSpy).not.toHaveBeenCalled()
    expect(voidSpy).not.toHaveBeenCalled()
    expect(deleteJobSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).toBe(
      P2pSmsSettleState.captured,
    )
  })

  it('deletes the job before releasing money; a delete failure moves no money', async () => {
    retrieveSpy.mockResolvedValue(mockIntent({ status: 'succeeded' }))
    deleteJobSpy.mockRejectedValue(new Error('peerly down'))
    const outreachId = await createRow({
      settleState: P2pSmsSettleState.captured,
      chargeIntentId: CHARGE_ID,
    })

    await expect(
      admin.deny(outreachId, { deniedBy: 'cas@gp.org', reason: 'bad' }),
    ).rejects.toThrow()
    // Money never moved — the job delete is first and its failure aborts the deny.
    expect(refundChargeSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).toBe(
      P2pSmsSettleState.captured,
    )
    expect((await readSpine(outreachId)).deniedAt).toBeNull()
  })

  it('leaves a NON-satellite deny as the send-back-for-edits stamp (no money, no job delete)', async () => {
    const outreachId = await createRow({ withSatellite: false })

    await admin.deny(outreachId, { deniedBy: 'cas@gp.org', reason: 'fix copy' })

    expect(refundChargeSpy).not.toHaveBeenCalled()
    expect(voidSpy).not.toHaveBeenCalled()
    expect(deleteJobSpy).not.toHaveBeenCalled()
    const spine = await readSpine(outreachId)
    expect(spine.deniedAt).not.toBeNull()
    expect(spine.deniedReason).toBe('fix copy')
    // The vendor job is untouched — the candidate can edit and re-queue.
    expect(spine.projectId).toBe('peerly-deny-job')
  })
})
