import { randomUUID } from 'node:crypto'
import {
  BadGatewayException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { addHours } from 'date-fns'
import type Stripe from 'stripe'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { OutreachP2pSmsCancelService } from '@/outreach/services/outreachP2pSmsCancel.service'
import { OutreachService } from '@/outreach/services/outreach.service'
import { OutreachNotificationService } from '@/outreach/services/outreachNotification.service'
import { StripeService } from '@/vendors/stripe/services/stripe.service'
import { PeerlyP2pJobService } from '@/vendors/peerly/services/peerlyP2pJob.service'
import {
  Campaign,
  OutreachStatus,
  P2pSmsSettleState,
} from '../../generated/prisma'

const service = useTestService()

let cancel: OutreachP2pSmsCancelService
let outreachService: OutreachService
let retrieveSpy: ReturnType<typeof vi.spyOn>
let refundChargeSpy: ReturnType<typeof vi.spyOn>
let refundIntentSpy: ReturnType<typeof vi.spyOn>
let voidSpy: ReturnType<typeof vi.spyOn>
let sessionSpy: ReturnType<typeof vi.spyOn>
let deleteJobSpy: ReturnType<typeof vi.spyOn>
let notifyCanceledSpy: ReturnType<typeof vi.spyOn>

let campaign: Campaign
let orgSlug: string
let filterId: number

const INTENT_ID = 'pi_hold_1'
const CHARGE_ID = 'ch_hold_1'

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

// A refund result with the given Stripe status (the only field the release reads).
const refundResult = (status: string): Stripe.Response<Stripe.Refund> =>
  ({ status }) as unknown as Stripe.Response<Stripe.Refund>

beforeEach(async () => {
  vi.stubEnv('WIN_SMS_HOLD_BILLING', 'true')
  // Keep the in-flight `refunding` poll short so race/stranded tests resolve fast.
  vi.stubEnv('WIN_SMS_REFUND_POLL_MS', '40')
  cancel = service.app.get(OutreachP2pSmsCancelService)
  outreachService = service.app.get(OutreachService)

  const stripe = service.app.get(StripeService)
  retrieveSpy = vi
    .spyOn(stripe, 'retrievePaymentIntent')
    .mockResolvedValue(mockIntent())
  refundChargeSpy = vi
    .spyOn(stripe, 'refundCharge')
    .mockResolvedValue(refundResult('succeeded'))
  refundIntentSpy = vi
    .spyOn(stripe, 'refundPaymentIntent')
    .mockResolvedValue({} as Stripe.Response<Stripe.Refund>)
  voidSpy = vi.spyOn(stripe, 'voidHold').mockResolvedValue(undefined)
  sessionSpy = vi
    .spyOn(stripe, 'retrieveCheckoutSession')
    .mockResolvedValue({} as Stripe.Response<Stripe.Checkout.Session>)
  deleteJobSpy = vi
    .spyOn(service.app.get(PeerlyP2pJobService), 'deleteJob')
    .mockResolvedValue(undefined)
  notifyCanceledSpy = vi
    .spyOn(service.app.get(OutreachNotificationService), 'notifyCanceled')
    .mockResolvedValue(undefined)

  const campaignId = 7700
  orgSlug = `campaign-${campaignId}`
  await service.prisma.organization.create({
    data: { slug: orgSlug, ownerId: service.user.id, positionId: 'pos-1' },
  })
  campaign = await service.prisma.campaign.create({
    data: {
      id: campaignId,
      organizationSlug: orgSlug,
      userId: service.user.id,
      slug: 'hold-cancel-me',
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

const createHold = async ({
  settleState,
  spineStatus = OutreachStatus.pending,
  authorizationIntentId = INTENT_ID as string | null,
  chargeIntentId = null as string | null,
  freeTextsApplied = false,
  projectId = 'peerly-job-1' as string | null,
  campaignId = campaign.id,
  approvedAt = null as Date | null,
}: {
  settleState: P2pSmsSettleState
  spineStatus?: OutreachStatus
  authorizationIntentId?: string | null
  chargeIntentId?: string | null
  freeTextsApplied?: boolean
  projectId?: string | null
  campaignId?: number
  approvedAt?: Date | null
}): Promise<number> => {
  const spine = await service.prisma.outreach.create({
    data: {
      campaignId,
      organizationSlug: `campaign-${campaignId}`,
      outreachType: 'p2p',
      status: spineStatus,
      date: addHours(new Date(), 72),
      voterFileFilterId: filterId,
      projectId,
      approvedAt,
      stripeCheckoutSessionId: 'cs_paid_1',
    },
  })
  await service.prisma.outreachP2pSms.create({
    data: {
      outreachId: spine.id,
      settleState,
      authorizationIntentId,
      authorizedAmountInCents: 5000,
      chargeIntentId,
      freeTextsApplied,
    },
  })
  return spine.id
}

const readSatellite = (outreachId: number) =>
  service.prisma.outreachP2pSms.findFirstOrThrow({ where: { outreachId } })
const readSpine = (outreachId: number) =>
  service.prisma.outreach.findUniqueOrThrow({ where: { id: outreachId } })

// Marks the campaign's free-texts offer as redeemed by THIS send, the state a
// restore unwinds.
const markOfferRedeemed = async (outreachId: number) => {
  await service.prisma.campaign.update({
    where: { id: campaign.id },
    data: { hasFreeTextsOffer: false, freeTextsOfferRedeemedAt: new Date() },
  })
  await service.prisma.outreachP2pSms.update({
    where: { outreachId },
    data: { freeTextsApplied: true },
  })
}

describe('OutreachP2pSmsCancelService.cancel', () => {
  it('voids the hold when an authorized send is canceled', async () => {
    retrieveSpy.mockResolvedValue(mockIntent({ status: 'requires_capture' }))
    const outreachId = await createHold({
      settleState: P2pSmsSettleState.authorized,
    })

    const { refunded } = await cancel.cancel(outreachId, campaign.id)

    expect(refunded).toBe(false)
    expect(voidSpy).toHaveBeenCalledWith(INTENT_ID)
    expect(refundChargeSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).toBe(
      P2pSmsSettleState.voided,
    )
    expect((await readSpine(outreachId)).status).toBe(OutreachStatus.canceled)
    expect(deleteJobSpy).toHaveBeenCalledWith('peerly-job-1')
  })

  it('restores the free-texts offer even when voidHold throws (void-path symmetry)', async () => {
    // voidHold swallows its own errors today, but the restore must not depend on
    // that: a throw from voidHold must never strand (burn) the offer this send
    // redeemed. The row is already terminal `voided` and the hold auto-expires,
    // so the cancel still completes without a 502.
    retrieveSpy.mockResolvedValue(mockIntent({ status: 'requires_capture' }))
    voidSpy.mockRejectedValueOnce(new Error('stripe void boom'))
    const outreachId = await createHold({
      settleState: P2pSmsSettleState.authorized,
    })
    await markOfferRedeemed(outreachId)

    const { refunded } = await cancel.cancel(outreachId, campaign.id)

    expect(refunded).toBe(false)
    expect(voidSpy).toHaveBeenCalledWith(INTENT_ID)
    expect((await readSatellite(outreachId)).settleState).toBe(
      P2pSmsSettleState.voided,
    )
    expect((await readSpine(outreachId)).status).toBe(OutreachStatus.canceled)
    const campaignAfter = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    })
    expect(campaignAfter.hasFreeTextsOffer).toBe(true)
    expect(campaignAfter.freeTextsOfferRedeemedAt).toBeNull()
  })

  it('refunds the captured charge when a captured send is canceled', async () => {
    retrieveSpy.mockResolvedValue(
      mockIntent({ status: 'succeeded', latest_charge: CHARGE_ID }),
    )
    const outreachId = await createHold({
      settleState: P2pSmsSettleState.captured,
      chargeIntentId: CHARGE_ID,
    })

    const { refunded } = await cancel.cancel(outreachId, campaign.id)

    expect(refunded).toBe(true)
    expect(refundChargeSpy).toHaveBeenCalledWith(
      CHARGE_ID,
      `p2p-sms-refund-${CHARGE_ID}`,
    )
    expect(voidSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).toBe(
      P2pSmsSettleState.refunded,
    )
    expect((await readSpine(outreachId)).status).toBe(OutreachStatus.canceled)
  })

  it('posts the CAS canceled notice on a hold-model cancel (parity with the shared body)', async () => {
    retrieveSpy.mockResolvedValue(mockIntent({ status: 'requires_capture' }))
    const outreachId = await createHold({
      settleState: P2pSmsSettleState.authorized,
    })

    await cancel.cancel(outreachId, campaign.id, {
      canceledBy: String(service.user.id),
      byAdmin: true,
    })

    expect(notifyCanceledSpy).toHaveBeenCalledOnce()
    expect(notifyCanceledSpy.mock.calls[0]?.[0]).toMatchObject({
      canceledByAdmin: true,
    })
  })

  it('refuses a capturing row (money mid-flight) and leaves it untouched', async () => {
    const outreachId = await createHold({
      settleState: P2pSmsSettleState.capturing,
      chargeIntentId: CHARGE_ID,
    })

    await expect(cancel.cancel(outreachId, campaign.id)).rejects.toBeInstanceOf(
      BadRequestException,
    )
    expect(refundChargeSpy).not.toHaveBeenCalled()
    expect(voidSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).toBe(
      P2pSmsSettleState.capturing,
    )
    expect((await readSpine(outreachId)).status).toBe(OutreachStatus.pending)
  })

  it('refunds off the SATELLITE charge, never the checkout session', async () => {
    retrieveSpy.mockResolvedValue(mockIntent({ status: 'succeeded' }))
    const outreachId = await createHold({
      settleState: P2pSmsSettleState.captured,
      chargeIntentId: CHARGE_ID,
    })

    await cancel.cancel(outreachId, campaign.id)

    expect(refundChargeSpy).toHaveBeenCalledWith(
      CHARGE_ID,
      `p2p-sms-refund-${CHARGE_ID}`,
    )
    // The hold-model delegate resolves the refund from the satellite intent; the
    // checkout-session refund path is never touched.
    expect(sessionSpy).not.toHaveBeenCalled()
    expect(refundIntentSpy).not.toHaveBeenCalled()
  })

  it('does NOT report refunded when Stripe returns a non-committed refund status', async () => {
    retrieveSpy.mockResolvedValue(mockIntent({ status: 'succeeded' }))
    // Stripe accepted the refund but it did not process (e.g. the bank rejected).
    refundChargeSpy.mockResolvedValue(refundResult('failed'))
    const outreachId = await createHold({
      settleState: P2pSmsSettleState.captured,
      chargeIntentId: CHARGE_ID,
    })

    await expect(cancel.cancel(outreachId, campaign.id)).rejects.toBeInstanceOf(
      BadGatewayException,
    )
    // Reverted so a retry re-attempts under the stable key; never reported
    // refunded, and the spine is not flipped canceled.
    expect((await readSatellite(outreachId)).settleState).toBe(
      P2pSmsSettleState.captured,
    )
    expect((await readSpine(outreachId)).status).toBe(OutreachStatus.pending)
  })

  it('branches on the LIVE intent, not a stale satellite state', async () => {
    // The satellite still reads `authorized` (its capture commit was lost) but
    // the live PI is `succeeded`: release must REFUND, never void.
    retrieveSpy.mockResolvedValue(
      mockIntent({ status: 'succeeded', latest_charge: CHARGE_ID }),
    )
    const outreachId = await createHold({
      settleState: P2pSmsSettleState.authorized,
      chargeIntentId: null,
    })

    const { refunded } = await cancel.cancel(outreachId, campaign.id)

    expect(refunded).toBe(true)
    expect(refundChargeSpy).toHaveBeenCalledWith(
      CHARGE_ID,
      `p2p-sms-refund-${CHARGE_ID}`,
    )
    expect(voidSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).toBe(
      P2pSmsSettleState.refunded,
    )
  })

  it('voidAuthorized refunds (never strands voided) when the live PI is unexpectedly succeeded', async () => {
    // releaseHold's first read sees requires_capture (→ void path). By the time
    // voidAuthorized re-reads after winning the void claim, the PI is succeeded —
    // the "impossible" captured-slipped-in case. Defense in depth: the money must
    // be refunded, never left stranded in voided with a captured charge.
    retrieveSpy
      .mockResolvedValueOnce(mockIntent({ status: 'requires_capture' }))
      .mockResolvedValue(
        mockIntent({ status: 'succeeded', latest_charge: CHARGE_ID }),
      )
    const outreachId = await createHold({
      settleState: P2pSmsSettleState.authorized,
      chargeIntentId: null,
    })

    const { refunded } = await cancel.cancel(outreachId, campaign.id)

    expect(refunded).toBe(true)
    expect(refundChargeSpy).toHaveBeenCalledWith(
      CHARGE_ID,
      `p2p-sms-refund-${CHARGE_ID}`,
    )
    expect(voidSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).toBe(
      P2pSmsSettleState.refunded,
    )
  })

  it('voidAuthorized never strands a captured charge when the recheck read FAILS: reverts to authorized and the loop refunds', async () => {
    // Outer read (attempt 0) sees requires_capture → voidAuthorized wins the
    // void claim, then its PI recheck THROWS while the charge is really
    // succeeded (a lost capture-response reverted capturing → authorized). The
    // catch must revert voided → authorized and NOT void; the outer loop then
    // re-reads the now-succeeded PI and refunds. The captured charge is never
    // stranded unrefunded behind a terminal `voided`.
    retrieveSpy
      .mockResolvedValueOnce(mockIntent({ status: 'requires_capture' }))
      .mockRejectedValueOnce(new Error('stripe unavailable'))
      .mockResolvedValue(
        mockIntent({ status: 'succeeded', latest_charge: CHARGE_ID }),
      )
    const outreachId = await createHold({
      settleState: P2pSmsSettleState.authorized,
      chargeIntentId: null,
    })

    const { refunded } = await cancel.cancel(outreachId, campaign.id)

    expect(refunded).toBe(true)
    expect(refundChargeSpy).toHaveBeenCalledWith(
      CHARGE_ID,
      `p2p-sms-refund-${CHARGE_ID}`,
    )
    // The failed recheck never voided the (captured) charge.
    expect(voidSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).toBe(
      P2pSmsSettleState.refunded,
    )
    expect((await readSpine(outreachId)).status).toBe(OutreachStatus.canceled)
  })

  it('voidAuthorized reverts to authorized and voids on the retry (never on the failed-recheck attempt)', async () => {
    // The recheck fails once, then recovers to a still-live hold: the void must
    // happen exactly once, on the retry — never on the attempt whose recheck
    // could not confirm the PI.
    retrieveSpy
      .mockResolvedValueOnce(mockIntent({ status: 'requires_capture' }))
      .mockRejectedValueOnce(new Error('stripe unavailable'))
      .mockResolvedValue(mockIntent({ status: 'requires_capture' }))
    const outreachId = await createHold({
      settleState: P2pSmsSettleState.authorized,
    })

    const { refunded } = await cancel.cancel(outreachId, campaign.id)

    expect(refunded).toBe(false)
    expect(voidSpy).toHaveBeenCalledOnce()
    expect(refundChargeSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).toBe(
      P2pSmsSettleState.voided,
    )
    expect((await readSpine(outreachId)).status).toBe(OutreachStatus.canceled)
  })

  it('voidAuthorized surfaces a retryable 502 (hold intact, not voided) when reads keep failing', async () => {
    // Attempt 0 reaches voidAuthorized; its recheck and every later read throw.
    // The row must end back in authorized (the hold intact) and the release must
    // surface a retryable BadGateway — never a terminal `voided`, never a void.
    retrieveSpy
      .mockResolvedValueOnce(mockIntent({ status: 'requires_capture' }))
      .mockRejectedValue(new Error('stripe down'))
    const outreachId = await createHold({
      settleState: P2pSmsSettleState.authorized,
    })

    await expect(cancel.cancel(outreachId, campaign.id)).rejects.toBeInstanceOf(
      BadGatewayException,
    )
    expect(voidSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).toBe(
      P2pSmsSettleState.authorized,
    )
    expect((await readSpine(outreachId)).status).toBe(OutreachStatus.pending)
  })

  it('restores the free-texts offer on a void', async () => {
    retrieveSpy.mockResolvedValue(mockIntent({ status: 'requires_capture' }))
    const outreachId = await createHold({
      settleState: P2pSmsSettleState.authorized,
    })
    await markOfferRedeemed(outreachId)

    await cancel.cancel(outreachId, campaign.id)

    const campaignAfter = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    })
    expect(campaignAfter.hasFreeTextsOffer).toBe(true)
    expect(campaignAfter.freeTextsOfferRedeemedAt).toBeNull()
    expect((await readSatellite(outreachId)).freeTextsApplied).toBe(false)
  })

  it('restores the free-texts offer on a refund', async () => {
    retrieveSpy.mockResolvedValue(mockIntent({ status: 'succeeded' }))
    const outreachId = await createHold({
      settleState: P2pSmsSettleState.captured,
      chargeIntentId: CHARGE_ID,
    })
    await markOfferRedeemed(outreachId)

    await cancel.cancel(outreachId, campaign.id)

    const campaignAfter = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    })
    expect(campaignAfter.hasFreeTextsOffer).toBe(true)
    expect(campaignAfter.freeTextsOfferRedeemedAt).toBeNull()
  })

  it('does NOT restore free texts for a send that never redeemed the offer', async () => {
    retrieveSpy.mockResolvedValue(mockIntent({ status: 'succeeded' }))
    // The campaign redeemed the offer on a DIFFERENT send; this one did not.
    await service.prisma.campaign.update({
      where: { id: campaign.id },
      data: { hasFreeTextsOffer: false, freeTextsOfferRedeemedAt: new Date() },
    })
    const outreachId = await createHold({
      settleState: P2pSmsSettleState.captured,
      chargeIntentId: CHARGE_ID,
      freeTextsApplied: false,
    })

    await cancel.cancel(outreachId, campaign.id)

    const campaignAfter = await service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    })
    // Untouched: this send owes nothing back.
    expect(campaignAfter.hasFreeTextsOffer).toBe(false)
    expect(campaignAfter.freeTextsOfferRedeemedAt).not.toBeNull()
  })

  it('releases a satellite row even with the flag OFF (kill-switch principle)', async () => {
    vi.stubEnv('WIN_SMS_HOLD_BILLING', 'false')
    retrieveSpy.mockResolvedValue(mockIntent({ status: 'succeeded' }))
    const outreachId = await createHold({
      settleState: P2pSmsSettleState.captured,
      chargeIntentId: CHARGE_ID,
    })

    const { refunded } = await cancel.cancel(outreachId, campaign.id)

    expect(refunded).toBe(true)
    expect(refundChargeSpy).toHaveBeenCalledOnce()
    expect((await readSatellite(outreachId)).settleState).toBe(
      P2pSmsSettleState.refunded,
    )
  })

  it('refuses a completed (sent) hold row and moves no money', async () => {
    retrieveSpy.mockResolvedValue(mockIntent({ status: 'succeeded' }))
    const outreachId = await createHold({
      settleState: P2pSmsSettleState.captured,
      chargeIntentId: CHARGE_ID,
      spineStatus: OutreachStatus.completed,
    })

    await expect(cancel.cancel(outreachId, campaign.id)).rejects.toBeInstanceOf(
      BadRequestException,
    )
    expect(refundChargeSpy).not.toHaveBeenCalled()
    expect(voidSpy).not.toHaveBeenCalled()
    expect(deleteJobSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).toBe(
      P2pSmsSettleState.captured,
    )
  })

  it('cancels a pending_payment satellite (no hold placed) without a 502', async () => {
    // The hold-recording webhook has not run yet: the satellite is seeded but
    // carries no authorization intent. Cancel must still complete (void the
    // never-placed hold, cancel the spine), not loop to a BadGateway.
    const outreachId = await createHold({
      settleState: P2pSmsSettleState.pending_payment,
      authorizationIntentId: null,
      spineStatus: OutreachStatus.pending_payment,
    })

    const { refunded } = await cancel.cancel(outreachId, campaign.id)

    expect(refunded).toBe(false)
    expect(retrieveSpy).not.toHaveBeenCalled()
    expect(refundChargeSpy).not.toHaveBeenCalled()
    expect(voidSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).toBe(
      P2pSmsSettleState.voided,
    )
    expect((await readSpine(outreachId)).status).toBe(OutreachStatus.canceled)
  })

  it('is idempotent on an already-refunded row', async () => {
    const outreachId = await createHold({
      settleState: P2pSmsSettleState.refunded,
      chargeIntentId: CHARGE_ID,
    })

    const { refunded } = await cancel.cancel(outreachId, campaign.id)

    expect(refunded).toBe(true)
    expect(refundChargeSpy).not.toHaveBeenCalled()
    expect(voidSpy).not.toHaveBeenCalled()
    // The spine is still flipped canceled on the idempotent path.
    expect((await readSpine(outreachId)).status).toBe(OutreachStatus.canceled)
  })

  it('re-attempts and actually refunds when the refund owner reverts refunding → captured', async () => {
    retrieveSpy.mockResolvedValue(mockIntent({ status: 'succeeded' }))
    // The row is mid-refund by another owner. That owner then hits a transient
    // Stripe error and reverts refunding → captured — so this caller must NOT
    // report success off the `refunding` observation; it must re-attempt and
    // issue the refund itself.
    const outreachId = await createHold({
      settleState: P2pSmsSettleState.refunding,
      chargeIntentId: CHARGE_ID,
    })

    // Start the cancel (its first poll observes `refunding` and begins sleeping),
    // then commit the owner's revert so the next poll reads `captured`.
    const cancelP = cancel.cancel(outreachId, campaign.id)
    await new Promise((resolve) => setTimeout(resolve, 20))
    await service.prisma.outreachP2pSms.updateMany({
      where: { outreachId },
      data: { settleState: P2pSmsSettleState.captured },
    })

    const { refunded } = await cancelP

    expect(refunded).toBe(true)
    expect(refundChargeSpy).toHaveBeenCalledWith(
      CHARGE_ID,
      `p2p-sms-refund-${CHARGE_ID}`,
    )
    expect((await readSatellite(outreachId)).settleState).toBe(
      P2pSmsSettleState.refunded,
    )
    expect((await readSpine(outreachId)).status).toBe(OutreachStatus.canceled)
  })

  it('refuses on an in-flight refunding claim WITHOUT deleting the job or flipping the spine', async () => {
    retrieveSpy.mockResolvedValue(mockIntent({ status: 'succeeded' }))
    // Another owner holds the single-owner `refunding` claim (and already deleted
    // the vendor job before claiming it). This cancel must refuse at the initial
    // read — never fall through to re-delete the job or re-enter the release and
    // leave the spine pending with the job gone and money unresolved. A retry
    // completes once that owner resolves; a stranded claim keeps surfacing this
    // for the slice-F reconcile. (This is also the stranded-refunding surfacing:
    // no false refund, spine not flipped.)
    const outreachId = await createHold({
      settleState: P2pSmsSettleState.refunding,
      chargeIntentId: CHARGE_ID,
    })

    await expect(cancel.cancel(outreachId, campaign.id)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    )
    expect(refundChargeSpy).not.toHaveBeenCalled()
    // The vendor job is NOT deleted here (the refunding owner already did), and
    // nothing re-enters the release before refusing.
    expect(deleteJobSpy).not.toHaveBeenCalled()
    // Still refunding (left for the reconcile sweep) and the spine is NOT canceled.
    expect((await readSatellite(outreachId)).settleState).toBe(
      P2pSmsSettleState.refunding,
    )
    expect((await readSpine(outreachId)).status).toBe(OutreachStatus.pending)
  })

  it('refunds exactly once when a deny and a cancel race the same charge', async () => {
    retrieveSpy.mockResolvedValue(mockIntent({ status: 'succeeded' }))
    // Hold the refund in flight so the loser reliably observes the winner's
    // `refunding` claim (the real-timing race the single-owner guard protects).
    refundChargeSpy.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => resolve(refundResult('succeeded')), 50),
        ),
    )
    const outreachId = await createHold({
      settleState: P2pSmsSettleState.captured,
      chargeIntentId: CHARGE_ID,
    })

    const [a, b] = await Promise.allSettled([
      cancel.cancel(outreachId, campaign.id),
      cancel.releaseForDeny(outreachId, campaign.id),
    ])

    expect([a, b].filter((r) => r.status === 'fulfilled')).toHaveLength(2)
    // The charge-keyed single-owner claim elects one refunder.
    expect(refundChargeSpy).toHaveBeenCalledOnce()
    expect((await readSatellite(outreachId)).settleState).toBe(
      P2pSmsSettleState.refunded,
    )
  })
})

describe('OutreachService.cancelOutreach dispatch', () => {
  it('delegates a hold-model p2p row to the satellite release (not the session refund)', async () => {
    retrieveSpy.mockResolvedValue(mockIntent({ status: 'succeeded' }))
    const outreachId = await createHold({
      settleState: P2pSmsSettleState.captured,
      chargeIntentId: CHARGE_ID,
    })

    const { refunded } = await outreachService.cancelOutreach(
      outreachId,
      campaign.id,
    )

    expect(refunded).toBe(true)
    expect(refundChargeSpy).toHaveBeenCalledWith(
      CHARGE_ID,
      `p2p-sms-refund-${CHARGE_ID}`,
    )
    // Never the checkout-session refund.
    expect(sessionSpy).not.toHaveBeenCalled()
    expect(refundIntentSpy).not.toHaveBeenCalled()
  })

  it('leaves a NON-satellite p2p cancel on the shared checkout-session path', async () => {
    refundIntentSpy.mockResolvedValue({} as Stripe.Response<Stripe.Refund>)
    sessionSpy.mockResolvedValue({
      payment_intent: 'pi_session',
    } as unknown as Stripe.Response<Stripe.Checkout.Session>)
    // A p2p row with NO OutreachP2pSms satellite — the immediate-charge path.
    const spine = await service.prisma.outreach.create({
      data: {
        campaignId: campaign.id,
        organizationSlug: orgSlug,
        outreachType: 'p2p',
        status: OutreachStatus.pending,
        date: addHours(new Date(), 72),
        voterFileFilterId: filterId,
        projectId: `peerly-${randomUUID()}`,
        stripeCheckoutSessionId: 'cs_immediate',
      },
    })

    const { refunded } = await outreachService.cancelOutreach(
      spine.id,
      campaign.id,
    )

    // Shared body: refunds off the checkout session, never the satellite path.
    expect(refunded).toBe(true)
    expect(sessionSpy).toHaveBeenCalledWith('cs_immediate')
    expect(refundIntentSpy).toHaveBeenCalled()
    expect(refundChargeSpy).not.toHaveBeenCalled()
    expect(voidSpy).not.toHaveBeenCalled()
  })
})
