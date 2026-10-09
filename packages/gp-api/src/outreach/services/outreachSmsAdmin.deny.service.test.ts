import { BadGatewayException, ConflictException } from '@nestjs/common'
import { addHours } from 'date-fns'
import type Stripe from 'stripe'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { OutreachSmsAdminService } from '@/outreach/services/outreachSmsAdmin.service'
import {
  HoldStillSettlingException,
  OutreachP2pSmsCancelService,
} from '@/outreach/services/outreachP2pSmsCancel.service'
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
let requestCanvassersSpy: ReturnType<typeof vi.spyOn>
let activateJobSpy: ReturnType<typeof vi.spyOn>

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

// A refund result with the given Stripe status (the only field the release reads).
const refundResult = (status: string): Stripe.Response<Stripe.Refund> =>
  ({ status }) as unknown as Stripe.Response<Stripe.Refund>

beforeEach(async () => {
  vi.stubEnv('WIN_SMS_HOLD_BILLING', 'true')
  admin = service.app.get(OutreachSmsAdminService)

  const stripe = service.app.get(StripeService)
  retrieveSpy = vi
    .spyOn(stripe, 'retrievePaymentIntent')
    .mockResolvedValue(mockIntent())
  refundChargeSpy = vi
    .spyOn(stripe, 'refundCharge')
    .mockResolvedValue(refundResult('succeeded'))
  voidSpy = vi.spyOn(stripe, 'voidHold').mockResolvedValue(undefined)
  const peerly = service.app.get(PeerlyP2pJobService)
  deleteJobSpy = vi.spyOn(peerly, 'deleteJob').mockResolvedValue(undefined)
  requestCanvassersSpy = vi
    .spyOn(peerly, 'requestCanvassers')
    .mockResolvedValue(undefined as never)
  activateJobSpy = vi
    .spyOn(peerly, 'activateJob')
    .mockResolvedValue(undefined as never)

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
    // The job delete runs before the release and its failure aborts the deny, so
    // money never moves (the denial CAS committed first; the stranded row is a
    // slice-F reconcile case).
    expect(refundChargeSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).toBe(
      P2pSmsSettleState.captured,
    )
  })

  it('aborts when a concurrent approve won the CAS (no job delete, no refund)', async () => {
    retrieveSpy.mockResolvedValue(mockIntent({ status: 'succeeded' }))
    // Simulate approve having committed first: approvedAt is stamped, so deny's
    // claim CAS matches nothing.
    const outreachId = await createRow({
      settleState: P2pSmsSettleState.captured,
      chargeIntentId: CHARGE_ID,
    })
    await service.prisma.outreach.update({
      where: { id: outreachId },
      data: { approvedAt: new Date(), approvedBy: 'other@gp.org' },
    })

    await expect(
      admin.deny(outreachId, { deniedBy: 'cas@gp.org', reason: 'bad' }),
    ).rejects.toBeInstanceOf(ConflictException)
    expect(deleteJobSpy).not.toHaveBeenCalled()
    expect(refundChargeSpy).not.toHaveBeenCalled()
    expect(voidSpy).not.toHaveBeenCalled()
    const spine = await readSpine(outreachId)
    expect(spine.deniedAt).toBeNull()
    expect((await readSatellite(outreachId)).settleState).toBe(
      P2pSmsSettleState.captured,
    )
  })

  it('deny racing approve: exactly one wins the CAS; a losing deny refunds nothing', async () => {
    retrieveSpy.mockResolvedValue(mockIntent({ status: 'succeeded' }))
    const outreachId = await createRow({
      settleState: P2pSmsSettleState.captured,
      chargeIntentId: CHARGE_ID,
    })

    const [approveRes, denyRes] = await Promise.allSettled([
      admin.approve(outreachId, { approvedBy: 'appr@gp.org' }),
      admin.deny(outreachId, { deniedBy: 'deny@gp.org', reason: 'x' }),
    ])

    // Symmetric CAS claims: exactly one of approve/deny commits; the other
    // aborts, so the row never ends with BOTH approvedAt and deniedAt.
    const fulfilled = [approveRes, denyRes].filter(
      (r) => r.status === 'fulfilled',
    )
    expect(fulfilled).toHaveLength(1)
    const spine = await readSpine(outreachId)
    expect(Boolean(spine.approvedAt) !== Boolean(spine.deniedAt)).toBe(true)

    if (spine.approvedAt) {
      // Approve won: deny aborted before touching the job or the money.
      expect(refundChargeSpy).not.toHaveBeenCalled()
      expect(deleteJobSpy).not.toHaveBeenCalled()
      expect((await readSatellite(outreachId)).settleState).toBe(
        P2pSmsSettleState.captured,
      )
    } else {
      // Deny won: refunded + job neutralized, and approve never booked.
      expect(refundChargeSpy).toHaveBeenCalledTimes(1)
      expect(requestCanvassersSpy).not.toHaveBeenCalled()
      expect((await readSatellite(outreachId)).settleState).toBe(
        P2pSmsSettleState.refunded,
      )
    }
    // The activation spy exists only so approve's best-effort activation no-ops.
    void activateJobSpy
  })

  it('reverts the denial ONLY for the capturing refusal, so a retry after the capture settles succeeds', async () => {
    retrieveSpy.mockResolvedValue(mockIntent({ status: 'succeeded' }))
    // Money mid-flight: the REAL releaseHold refuses a `capturing` row with
    // HoldStillSettlingException, after the denial CAS already committed. No
    // release transition commits on that path, so reverting the denial is safe.
    const outreachId = await createRow({
      settleState: P2pSmsSettleState.capturing,
      chargeIntentId: CHARGE_ID,
    })

    // The typed, money-safe refusal surfaces unchanged (not a stranded-CAS 409).
    await expect(
      admin.deny(outreachId, { deniedBy: 'cas@gp.org', reason: 'bad' }),
    ).rejects.toBeInstanceOf(HoldStillSettlingException)

    const reverted = await readSpine(outreachId)
    expect(reverted.deniedAt).toBeNull()
    expect(reverted.deniedBy).toBeNull()
    expect(reverted.deniedReason).toBeNull()
    expect(refundChargeSpy).not.toHaveBeenCalled()
    expect((await readSatellite(outreachId)).settleState).toBe(
      P2pSmsSettleState.capturing,
    )

    // The capture settles; the row is reviewable again, so the retry succeeds
    // instead of hitting a stale-CAS Conflict, and now refunds.
    await service.prisma.outreachP2pSms.update({
      where: { outreachId },
      data: { settleState: P2pSmsSettleState.captured },
    })
    await admin.deny(outreachId, { deniedBy: 'cas@gp.org', reason: 'bad' })
    expect(refundChargeSpy).toHaveBeenCalledWith(
      CHARGE_ID,
      `p2p-sms-refund-${CHARGE_ID}`,
    )
    const resolved = await readSpine(outreachId)
    expect(resolved.deniedAt).not.toBeNull()
    expect((await readSatellite(outreachId)).settleState).toBe(
      P2pSmsSettleState.refunded,
    )
  })

  it('keeps the denial committed on a NON-capturing release failure (never reopens a refund-and-send window)', async () => {
    retrieveSpy.mockResolvedValue(mockIntent({ status: 'succeeded' }))
    const outreachId = await createRow({
      settleState: P2pSmsSettleState.captured,
      chargeIntentId: CHARGE_ID,
    })

    const cancelService = service.app.get(OutreachP2pSmsCancelService)
    // A failure AFTER a refund may have committed (e.g. the refunding → refunded
    // DB write threw): NOT a HoldStillSettlingException, so the denial must stay
    // committed — reverting it would let an approve send an already-refunded row.
    vi.spyOn(cancelService, 'releaseForDeny').mockRejectedValueOnce(
      new BadGatewayException('db write failed after refund'),
    )

    await expect(
      admin.deny(outreachId, { deniedBy: 'cas@gp.org', reason: 'bad' }),
    ).rejects.toBeInstanceOf(BadGatewayException)

    // Denial stays committed: the row is NOT reviewable/approvable again.
    const stillDenied = await readSpine(outreachId)
    expect(stillDenied.deniedAt).not.toBeNull()
    expect(stillDenied.deniedBy).toBe('cas@gp.org')
    expect(stillDenied.deniedReason).toBe('bad')

    // A second deny finds no reviewable row (deniedAt set) → ConflictException,
    // proving no refund-and-also-send window opened.
    await expect(
      admin.deny(outreachId, { deniedBy: 'cas@gp.org', reason: 'bad' }),
    ).rejects.toBeInstanceOf(ConflictException)
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
