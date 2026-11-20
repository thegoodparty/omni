import { addHours, subMinutes } from 'date-fns'
import Stripe from 'stripe'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { OutreachP2pSmsCancelService } from '@/outreach/services/outreachP2pSmsCancel.service'
import { OutreachP2pSmsCaptureService } from '@/outreach/services/outreachP2pSmsCapture.service'
import { OutreachNotificationService } from '@/outreach/services/outreachNotification.service'
import { OutreachCreditsService } from '@/outreachCredits/services/outreachCredits.service'
import { calcTextAmountInCents } from '@/shared/util/textPricing.util'
import { StripeService } from '@/vendors/stripe/services/stripe.service'
import { PeerlyP2pJobService } from '@/vendors/peerly/services/peerlyP2pJob.service'
import { PeerlyJob } from '@/vendors/peerly/peerly.types'
import {
  Campaign,
  OutreachStatus,
  P2pSmsSettleState,
  PhoneListBuildStatus,
} from '../../generated/prisma'

const service = useTestService({ jobs: true })

const INTENT_ID = 'pi_credit_1'
const CHARGE_ID = 'ch_credit_1'
const START_BALANCE = 20000
const LEADS = 2000
const COST = calcTextAmountInCents(LEADS)

let credits: OutreachCreditsService
let cancel: OutreachP2pSmsCancelService
let capture: OutreachP2pSmsCaptureService
let retrieveSpy: ReturnType<typeof vi.spyOn>
let refundChargeSpy: ReturnType<typeof vi.spyOn>
let captureIntentSpy: ReturnType<typeof vi.spyOn>

let campaign: Campaign
let orgSlug: string
let filterId: number

const intent = (
  overrides: Partial<Stripe.PaymentIntent> = {},
): Stripe.Response<Stripe.PaymentIntent> =>
  ({
    id: INTENT_ID,
    object: 'payment_intent',
    status: 'succeeded',
    amount: COST,
    amount_received: COST,
    latest_charge: CHARGE_ID,
    ...overrides,
  }) as unknown as Stripe.Response<Stripe.PaymentIntent>

const refundResult = (status: string): Stripe.Response<Stripe.Refund> =>
  ({ status }) as unknown as Stripe.Response<Stripe.Refund>

const balance = async () =>
  (
    await service.prisma.campaign.findUniqueOrThrow({
      where: { id: campaign.id },
    })
  ).outreachCreditCents

const readSatellite = (outreachId: number) =>
  service.prisma.outreachP2pSms.findFirstOrThrow({ where: { outreachId } })
const readSpine = (outreachId: number) =>
  service.prisma.outreach.findUniqueOrThrow({ where: { id: outreachId } })

beforeEach(async () => {
  vi.stubEnv('WIN_SMS_REFUND_POLL_MS', '40')
  credits = service.app.get(OutreachCreditsService)
  cancel = service.app.get(OutreachP2pSmsCancelService)
  capture = service.app.get(OutreachP2pSmsCaptureService)

  const stripe = service.app.get(StripeService)
  retrieveSpy = vi
    .spyOn(stripe, 'retrievePaymentIntent')
    .mockResolvedValue(intent())
  refundChargeSpy = vi
    .spyOn(stripe, 'refundCharge')
    .mockResolvedValue(refundResult('succeeded'))
  vi.spyOn(stripe, 'listChargeRefunds').mockResolvedValue([])
  captureIntentSpy = vi
    .spyOn(stripe, 'capturePaymentIntent')
    .mockResolvedValue(intent())
  vi.spyOn(stripe, 'voidHold').mockResolvedValue(undefined)
  vi.spyOn(service.app.get(PeerlyP2pJobService), 'deleteJob').mockResolvedValue(
    undefined,
  )
  vi.spyOn(service.app.get(PeerlyP2pJobService), 'getJob').mockResolvedValue({
    status: 'paused',
    has_canvassers_scheduled: false,
    canvassers_schedule: null,
  } as unknown as PeerlyJob)
  vi.spyOn(
    service.app.get(OutreachNotificationService),
    'notifyCanceled',
  ).mockResolvedValue(undefined)

  const campaignId = 7790
  orgSlug = `campaign-${campaignId}`
  await service.prisma.organization.create({
    data: { slug: orgSlug, ownerId: service.user.id, positionId: 'pos-1' },
  })
  campaign = await service.prisma.campaign.create({
    data: {
      id: campaignId,
      organizationSlug: orgSlug,
      userId: service.user.id,
      slug: 'credit-refund-me',
      isPro: true,
      outreachCreditCents: START_BALANCE,
      details: {},
      data: {},
    },
  })
  filterId = (
    await service.prisma.voterFileFilter.create({
      data: { organizationSlug: orgSlug },
    })
  ).id
})

// A hold-billed send with `reservedCents` of credit drawn at checkout. The list
// is ready with LEADS texts so a capture can run against it.
const createSend = async ({
  settleState,
  reservedCents,
}: {
  settleState: P2pSmsSettleState
  reservedCents: number
}): Promise<number> => {
  const listId = 9000 + Math.floor(Math.random() * 1000)
  await service.prisma.peerlyPhoneList.create({
    data: {
      organizationSlug: orgSlug,
      campaignId: campaign.id,
      peerlyListId: listId,
      buildStatus: PhoneListBuildStatus.ready,
      leadsLoaded: LEADS,
    },
  })
  const spine = await service.prisma.outreach.create({
    data: {
      campaignId: campaign.id,
      organizationSlug: orgSlug,
      outreachType: 'p2p',
      status: OutreachStatus.pending,
      date: addHours(new Date(), 72),
      voterFileFilterId: filterId,
      projectId: 'peerly-job-1',
      phoneListId: listId,
      stripeCheckoutSessionId: 'cs_paid_1',
    },
  })
  await service.prisma.outreachP2pSms.create({
    data: {
      outreachId: spine.id,
      settleState,
      authorizationIntentId: INTENT_ID,
      authorizedAmountInCents: COST,
      chargeIntentId: CHARGE_ID,
      captureBefore: addHours(new Date(), 100),
    },
  })
  await service.prisma.$transaction((tx) =>
    credits.reserve(tx, campaign.id, spine.id, reservedCents),
  )
  return spine.id
}

// The state a completed capture leaves: credit settled in the commit.
const capturedSend = async (reservedCents: number): Promise<number> => {
  const outreachId = await createSend({
    settleState: P2pSmsSettleState.captured,
    reservedCents,
  })
  await credits.settle(outreachId, COST)
  return outreachId
}

describe('refund of a captured send with plan credit', () => {
  it('returns the credit it used along with the card refund', async () => {
    const outreachId = await capturedSend(5000)
    expect(await balance()).toBe(START_BALANCE - 5000)

    const { refunded } = await cancel.cancel(outreachId, campaign.id)

    expect(refunded).toBe(true)
    expect(refundChargeSpy).toHaveBeenCalledTimes(1)
    expect(await balance()).toBe(START_BALANCE)
    expect((await readSpine(outreachId)).creditRefundedAt).not.toBeNull()
  })

  it('moves nothing on a second refund of the same send', async () => {
    const outreachId = await capturedSend(5000)

    await cancel.cancel(outreachId, campaign.id)
    await cancel.cancel(outreachId, campaign.id)
    await service.app
      .get(OutreachP2pSmsCancelService)
      .cancel(outreachId, campaign.id)

    expect(await balance()).toBe(START_BALANCE)
  })

  it('returns the credit of a send it covered in full, which settled at $0', async () => {
    const outreachId = await createSend({
      settleState: P2pSmsSettleState.captured,
      reservedCents: COST,
    })
    await service.prisma.outreachP2pSms.update({
      where: { outreachId },
      data: { capturedAmountInCents: 0 },
    })
    await credits.settle(outreachId, COST)
    expect(await balance()).toBe(START_BALANCE - COST)

    await cancel.cancel(outreachId, campaign.id)

    expect(refundChargeSpy).not.toHaveBeenCalled()
    expect(await balance()).toBe(START_BALANCE)
  })

  it('gives nothing back once the plan has ended', async () => {
    const outreachId = await capturedSend(5000)
    await service.prisma.campaign.update({
      where: { id: campaign.id },
      data: { planEndedAt: new Date() },
    })

    await cancel.cancel(outreachId, campaign.id)

    expect(refundChargeSpy).toHaveBeenCalledTimes(1)
    expect(await balance()).toBe(START_BALANCE - 5000)
  })

  it('returns no credit while the refund fails, and the retry returns it once', async () => {
    const outreachId = await capturedSend(5000)
    refundChargeSpy.mockRejectedValueOnce(
      new Stripe.errors.StripeConnectionError({
        message: 'An error occurred with our connection to Stripe.',
        type: 'api_error',
      }),
    )

    await expect(cancel.cancel(outreachId, campaign.id)).rejects.toThrow()
    expect(await balance()).toBe(START_BALANCE - 5000)
    expect((await readSatellite(outreachId)).settleState).toBe(
      P2pSmsSettleState.captured,
    )

    await cancel.cancel(outreachId, campaign.id)
    expect(await balance()).toBe(START_BALANCE)
  })

  it('returns the credit when the reconcile sweep resolves a stranded refunding row', async () => {
    vi.stubEnv('OTEL_SERVICE_ENVIRONMENT', 'prod')
    const outreachId = await capturedSend(5000)
    await service.prisma.outreachP2pSms.update({
      where: { outreachId },
      data: { settleState: P2pSmsSettleState.refunding },
    })
    await service.prisma.$executeRaw`
      UPDATE outreach_p2p_sms
      SET updated_at = ${subMinutes(new Date(), 20)}
      WHERE outreach_id = ${outreachId}`

    await service.jobs.runSchedule('p2pSmsRefundingReconcileSweep')
    await service.jobs.runSchedule('p2pSmsRefundingReconcileSweep')

    expect((await readSatellite(outreachId)).settleState).toBe(
      P2pSmsSettleState.refunded,
    )
    expect(await balance()).toBe(START_BALANCE)
  })

  it('keeps the credit with a send whose hold is voided before capture, which never used any', async () => {
    retrieveSpy.mockResolvedValue(intent({ status: 'requires_capture' }))
    const outreachId = await createSend({
      settleState: P2pSmsSettleState.authorized,
      reservedCents: 5000,
    })

    await cancel.cancel(outreachId, campaign.id)

    expect(await balance()).toBe(START_BALANCE)
    expect((await readSpine(outreachId)).creditUsedCents).toBe(0)
  })
})

describe('cancel while the capture is in flight', () => {
  it('is refused and leaves the reserve alone, then the capture settles the credit once', async () => {
    const reserved = 5000
    const outreachId = await createSend({
      settleState: P2pSmsSettleState.authorized,
      reservedCents: reserved,
    })
    retrieveSpy.mockResolvedValue(intent({ status: 'requires_capture' }))
    let cancelDuringCapture: unknown
    captureIntentSpy.mockImplementation(async () => {
      cancelDuringCapture = await cancel
        .cancel(outreachId, campaign.id)
        .catch((err: unknown) => err)
      expect((await readSatellite(outreachId)).settleState).toBe(
        P2pSmsSettleState.capturing,
      )
      const mid = await readSpine(outreachId)
      expect(mid.creditReservedCents).toBe(reserved)
      expect(mid.creditSettledAt).toBeNull()
      expect(await balance()).toBe(START_BALANCE - reserved)
      return intent({ amount_received: COST - reserved })
    })

    await capture.captureHold(outreachId)

    expect(cancelDuringCapture).toMatchObject({
      message: expect.stringContaining('still'),
    })
    expect(captureIntentSpy).toHaveBeenCalledWith(
      INTENT_ID,
      COST - reserved,
      expect.any(String),
    )
    expect((await readSatellite(outreachId)).settleState).toBe(
      P2pSmsSettleState.captured,
    )
    const settled = await readSpine(outreachId)
    expect(settled.creditSettledAt).not.toBeNull()
    expect(settled.creditUsedCents).toBe(reserved)
    expect(await balance()).toBe(START_BALANCE - reserved)

    await capture.captureHold(outreachId)
    expect(captureIntentSpy).toHaveBeenCalledTimes(1)
    expect(await balance()).toBe(START_BALANCE - reserved)
  })
})
