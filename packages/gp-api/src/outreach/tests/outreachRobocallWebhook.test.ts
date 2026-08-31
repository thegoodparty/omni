import { randomUUID } from 'node:crypto'
import { addDays } from 'date-fns'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Stripe from 'stripe'
import { useTestService } from '@/test-service'
import { StripeService } from '@/vendors/stripe/services/stripe.service'
import { OutreachRobocallWebhookService } from '@/outreach/services/outreachRobocallWebhook.service'
import { OutreachRobocallHoldService } from '@/outreach/services/outreachRobocallHold.service'
import { Campaign, RobocallSettleState } from '../../generated/prisma'

const service = useTestService()

const paymentIntentsCancel = vi.fn()

let campaign: Campaign
let orgSlug: string
let filterId: number
let webhooks: OutreachRobocallWebhookService

beforeEach(async () => {
  const stripe = service.app.get(StripeService)
  const stripeClient = (stripe as unknown as { stripe: Stripe }).stripe
  vi.spyOn(stripeClient.paymentIntents, 'cancel').mockImplementation(
    paymentIntentsCancel,
  )
  paymentIntentsCancel.mockResolvedValue({ id: 'canceled' })

  webhooks = service.app.get(OutreachRobocallWebhookService)

  const campaignId = 998
  orgSlug = `campaign-${campaignId}`

  await service.prisma.organization.create({
    data: { slug: orgSlug, ownerId: service.user.id, positionId: 'pos-1' },
  })

  campaign = await service.prisma.campaign.create({
    data: {
      id: campaignId,
      organizationSlug: orgSlug,
      userId: service.user.id,
      slug: 'jane-doe',
      isPro: true,
      details: { state: 'TX', city: 'Georgetown', zip: '78634' },
      data: {},
      aiContent: {},
    },
  })

  const filter = await service.prisma.voterFileFilter.create({
    data: { organizationSlug: orgSlug },
  })
  filterId = filter.id
})

const createDraft = async ({
  settleState = RobocallSettleState.pending_payment,
  paymentMethodId,
  authorizationIntentId,
  chargeIntentId,
  stripeCustomerId,
  sendAt = addDays(new Date(), 2),
}: {
  settleState?: RobocallSettleState
  paymentMethodId?: string
  authorizationIntentId?: string
  chargeIntentId?: string
  stripeCustomerId?: string
  sendAt?: Date
} = {}): Promise<number> => {
  const spine = await service.prisma.outreach.create({
    data: {
      campaignId: campaign.id,
      organizationSlug: orgSlug,
      outreachType: 'robocall',
      status: 'pending_payment',
      date: sendAt,
      voterFileFilterId: filterId,
    },
  })
  await service.prisma.outreachRobocall.create({
    data: {
      outreachId: spine.id,
      audioKey: `robocall/998/${randomUUID()}.webm`,
      callbackNumber: '+15125550123',
      billableCount: 100,
      amountInCents: 450,
      settleState,
      ...(paymentMethodId ? { paymentMethodId } : {}),
      ...(authorizationIntentId ? { authorizationIntentId } : {}),
      ...(chargeIntentId ? { chargeIntentId } : {}),
      ...(stripeCustomerId ? { stripeCustomerId } : {}),
    },
  })
  return spine.id
}

const readSatellite = (outreachId: number) =>
  service.prisma.outreachRobocall.findUniqueOrThrow({ where: { outreachId } })

describe('OutreachRobocallWebhookService', () => {
  describe('cancelNotYetDialedForDetachedPaymentMethod', () => {
    it('cancels an authorized run on the card and voids its hold', async () => {
      const outreachId = await createDraft({
        settleState: RobocallSettleState.authorized,
        paymentMethodId: 'pm_gone',
        authorizationIntentId: 'pi_hold_1',
      })
      // An authorized run is visible in history (spine `pending`); the cancel
      // must hide it, not leave it as "In review".
      await service.prisma.outreach.update({
        where: { id: outreachId },
        data: { status: 'pending' },
      })

      await webhooks.cancelNotYetDialedForDetachedPaymentMethod('pm_gone')

      const satellite = await readSatellite(outreachId)
      expect(satellite.settleState).toBe(RobocallSettleState.cancelled)
      const spine = await service.prisma.outreach.findUniqueOrThrow({
        where: { id: outreachId },
      })
      expect(spine.status).toBe('canceled')
      expect(paymentIntentsCancel).toHaveBeenCalledExactlyOnceWith('pi_hold_1')
      // The best-effort void is recorded for the reconcile sweep.
      const orphan = await service.prisma.robocallOrphanedHold.findUnique({
        where: { paymentIntentId: 'pi_hold_1' },
      })
      expect(orphan?.reason).toBe('cancel_before_send')
    })

    it('cancels a persisted pending_payment run without a hold to void', async () => {
      const outreachId = await createDraft({
        settleState: RobocallSettleState.pending_payment,
        paymentMethodId: 'pm_gone',
      })

      await webhooks.cancelNotYetDialedForDetachedPaymentMethod('pm_gone')

      const satellite = await readSatellite(outreachId)
      expect(satellite.settleState).toBe(RobocallSettleState.cancelled)
      expect(paymentIntentsCancel).not.toHaveBeenCalled()
    })

    it('cancels hold_pending and staging runs on the card', async () => {
      const holdPending = await createDraft({
        settleState: RobocallSettleState.hold_pending,
        paymentMethodId: 'pm_gone',
      })
      const staging = await createDraft({
        settleState: RobocallSettleState.staging,
        paymentMethodId: 'pm_gone',
        authorizationIntentId: 'pi_stage',
      })

      await webhooks.cancelNotYetDialedForDetachedPaymentMethod('pm_gone')

      expect((await readSatellite(holdPending)).settleState).toBe(
        RobocallSettleState.cancelled,
      )
      expect((await readSatellite(staging)).settleState).toBe(
        RobocallSettleState.cancelled,
      )
      expect(paymentIntentsCancel).toHaveBeenCalledExactlyOnceWith('pi_stage')
    })

    it('never touches a dialed or settling run on the same card', async () => {
      const dialed = await createDraft({
        settleState: RobocallSettleState.dialed,
        paymentMethodId: 'pm_gone',
        authorizationIntentId: 'pi_dialed',
      })
      const settling = await createDraft({
        settleState: RobocallSettleState.settling,
        paymentMethodId: 'pm_gone',
        authorizationIntentId: 'pi_settling',
      })

      await webhooks.cancelNotYetDialedForDetachedPaymentMethod('pm_gone')

      expect((await readSatellite(dialed)).settleState).toBe(
        RobocallSettleState.dialed,
      )
      expect((await readSatellite(settling)).settleState).toBe(
        RobocallSettleState.settling,
      )
      expect(paymentIntentsCancel).not.toHaveBeenCalled()
    })

    it('is idempotent: a redelivered detached event is a no-op', async () => {
      const outreachId = await createDraft({
        settleState: RobocallSettleState.authorized,
        paymentMethodId: 'pm_gone',
        authorizationIntentId: 'pi_hold_1',
      })

      await webhooks.cancelNotYetDialedForDetachedPaymentMethod('pm_gone')
      await webhooks.cancelNotYetDialedForDetachedPaymentMethod('pm_gone')

      const satellite = await readSatellite(outreachId)
      expect(satellite.settleState).toBe(RobocallSettleState.cancelled)
      // The second delivery finds the row already cancelled and voids nothing.
      expect(paymentIntentsCancel).toHaveBeenCalledExactlyOnceWith('pi_hold_1')
    })

    it('ignores runs bound to a different card', async () => {
      const other = await createDraft({
        settleState: RobocallSettleState.authorized,
        paymentMethodId: 'pm_other',
        authorizationIntentId: 'pi_other',
      })

      await webhooks.cancelNotYetDialedForDetachedPaymentMethod('pm_gone')

      expect((await readSatellite(other)).settleState).toBe(
        RobocallSettleState.authorized,
      )
      expect(paymentIntentsCancel).not.toHaveBeenCalled()
    })
  })

  describe('markDisputedByIntent', () => {
    it('marks the run matched by its authorization intent disputed', async () => {
      const disputed = await createDraft({
        settleState: RobocallSettleState.captured,
        authorizationIntentId: 'pi_hold_1',
      })
      const untouched = await createDraft({
        settleState: RobocallSettleState.captured,
        authorizationIntentId: 'pi_hold_2',
      })

      await webhooks.markDisputedByIntent('pi_hold_1')

      expect((await readSatellite(disputed)).settleState).toBe(
        RobocallSettleState.disputed,
      )
      expect((await readSatellite(untouched)).settleState).toBe(
        RobocallSettleState.captured,
      )
    })

    it('marks the run matched by its charge intent disputed', async () => {
      const disputed = await createDraft({
        settleState: RobocallSettleState.charged,
        chargeIntentId: 'pi_charge_1',
      })

      await webhooks.markDisputedByIntent('pi_charge_1')

      expect((await readSatellite(disputed)).settleState).toBe(
        RobocallSettleState.disputed,
      )
    })

    it('ignores a dispute whose intent maps to no run', async () => {
      const unrelated = await createDraft({
        settleState: RobocallSettleState.captured,
        authorizationIntentId: 'pi_hold_1',
      })

      await expect(
        webhooks.markDisputedByIntent('pi_unknown'),
      ).resolves.toBeUndefined()

      expect((await readSatellite(unrelated)).settleState).toBe(
        RobocallSettleState.captured,
      )
    })

    it('is idempotent: a redelivered dispute re-writes the same terminal', async () => {
      const disputed = await createDraft({
        settleState: RobocallSettleState.captured,
        authorizationIntentId: 'pi_hold_1',
      })

      await webhooks.markDisputedByIntent('pi_hold_1')
      await webhooks.markDisputedByIntent('pi_hold_1')

      expect((await readSatellite(disputed)).settleState).toBe(
        RobocallSettleState.disputed,
      )
    })
  })

  describe('retryHoldFailedForAttachedCard', () => {
    const CUSTOMER = 'cus_1'
    const NEW_PM = 'pm_new'
    const originalFlag = process.env.ROBOCALL_DEFERRED_HOLD_ENABLED
    let authorizeSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      process.env.ROBOCALL_DEFERRED_HOLD_ENABLED = 'true'
      authorizeSpy = vi
        .spyOn(service.app.get(OutreachRobocallHoldService), 'authorizeHold')
        .mockResolvedValue({
          status: 'authorized',
          settleState: RobocallSettleState.authorized,
          authorizedAmountInCents: 450,
        })
    })
    afterEach(() => {
      if (originalFlag === undefined) {
        delete process.env.ROBOCALL_DEFERRED_HOLD_ENABLED
      } else {
        process.env.ROBOCALL_DEFERRED_HOLD_ENABLED = originalFlag
      }
    })

    it('retries the hold for an in-window hold_failed draft with the new card', async () => {
      const outreachId = await createDraft({
        settleState: RobocallSettleState.hold_failed,
        stripeCustomerId: CUSTOMER,
      })

      await webhooks.retryHoldFailedForAttachedCard(CUSTOMER, NEW_PM)

      expect(authorizeSpy).toHaveBeenCalledTimes(1)
      const call = authorizeSpy.mock.calls[0]
      // authorizeHold(user, campaign, organization, outreachId, paymentMethodId)
      expect(call?.[3]).toBe(outreachId)
      expect(call?.[4]).toBe(NEW_PM)
      // Passes the draft's OWN user/campaign/org — a wrong identity here is how a
      // cross-tenant hold would be placed, so assert all three explicitly.
      expect(call?.[0]?.id).toBe(service.user.id)
      expect(call?.[1]?.id).toBe(campaign.id)
      expect(call?.[2]?.slug).toBe(orgSlug)
    })

    it('skips a draft whose send time has already passed', async () => {
      await createDraft({
        settleState: RobocallSettleState.hold_failed,
        stripeCustomerId: CUSTOMER,
        sendAt: addDays(new Date(), -1),
      })

      await webhooks.retryHoldFailedForAttachedCard(CUSTOMER, NEW_PM)

      expect(authorizeSpy).not.toHaveBeenCalled()
    })

    it('skips a hold_failed draft scheduled beyond the hold window', async () => {
      // Out of the window, authorizeHold would take the defer branch (whose
      // persist CAS is pending_payment-only) and silently drop the new card, so
      // the retry must NOT select it — it stays for the sweep once in-window.
      await createDraft({
        settleState: RobocallSettleState.hold_failed,
        stripeCustomerId: CUSTOMER,
        sendAt: addDays(new Date(), 6),
      })

      await webhooks.retryHoldFailedForAttachedCard(CUSTOMER, NEW_PM)

      expect(authorizeSpy).not.toHaveBeenCalled()
    })

    it('skips a hold_failed draft for a different customer', async () => {
      await createDraft({
        settleState: RobocallSettleState.hold_failed,
        stripeCustomerId: 'cus_other',
      })

      await webhooks.retryHoldFailedForAttachedCard(CUSTOMER, NEW_PM)

      expect(authorizeSpy).not.toHaveBeenCalled()
    })

    it('skips a draft that is not hold_failed', async () => {
      await createDraft({
        settleState: RobocallSettleState.authorized,
        stripeCustomerId: CUSTOMER,
      })

      await webhooks.retryHoldFailedForAttachedCard(CUSTOMER, NEW_PM)

      expect(authorizeSpy).not.toHaveBeenCalled()
    })

    it('no-ops when the off-session hold kill-switch is unset', async () => {
      delete process.env.ROBOCALL_DEFERRED_HOLD_ENABLED
      await createDraft({
        settleState: RobocallSettleState.hold_failed,
        stripeCustomerId: CUSTOMER,
      })

      await webhooks.retryHoldFailedForAttachedCard(CUSTOMER, NEW_PM)

      expect(authorizeSpy).not.toHaveBeenCalled()
    })

    it('is idempotent across a webhook redelivery: no second attempt', async () => {
      const outreachId = await createDraft({
        settleState: RobocallSettleState.hold_failed,
        stripeCustomerId: CUSTOMER,
      })

      await webhooks.retryHoldFailedForAttachedCard(CUSTOMER, NEW_PM)
      expect(authorizeSpy).toHaveBeenCalledTimes(1)

      // authorizeHold's real single-owner CAS advances the claimed draft out of
      // hold_failed; the mock does not, so advance it by hand to reproduce that
      // state, then redeliver. The handler must NOT re-attempt a draft that is
      // no longer hold_failed.
      await service.prisma.outreachRobocall.updateMany({
        where: {
          outreachId,
          settleState: RobocallSettleState.hold_failed,
        },
        data: { settleState: RobocallSettleState.authorized },
      })
      await webhooks.retryHoldFailedForAttachedCard(CUSTOMER, NEW_PM)

      expect(authorizeSpy).toHaveBeenCalledTimes(1)
    })

    it('isolates a per-draft failure: one throw does not abort the rest', async () => {
      const first = await createDraft({
        settleState: RobocallSettleState.hold_failed,
        stripeCustomerId: CUSTOMER,
      })
      const second = await createDraft({
        settleState: RobocallSettleState.hold_failed,
        stripeCustomerId: CUSTOMER,
      })
      authorizeSpy.mockRejectedValueOnce(new Error('transient stripe'))

      await webhooks.retryHoldFailedForAttachedCard(CUSTOMER, NEW_PM)

      // Both drafts were attempted despite the first throwing.
      expect(authorizeSpy).toHaveBeenCalledTimes(2)
      const attempted = [
        authorizeSpy.mock.calls[0]?.[3],
        authorizeSpy.mock.calls[1]?.[3],
      ]
      expect(attempted).toContain(first)
      expect(attempted).toContain(second)
    })
  })
})
