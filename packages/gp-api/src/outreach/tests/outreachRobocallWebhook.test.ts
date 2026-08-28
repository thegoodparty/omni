import { randomUUID } from 'node:crypto'
import { addDays } from 'date-fns'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Stripe from 'stripe'
import { useTestService } from '@/test-service'
import { StripeService } from '@/vendors/stripe/services/stripe.service'
import { OutreachRobocallWebhookService } from '@/outreach/services/outreachRobocallWebhook.service'
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
}: {
  settleState?: RobocallSettleState
  paymentMethodId?: string
  authorizationIntentId?: string
  chargeIntentId?: string
} = {}): Promise<number> => {
  const spine = await service.prisma.outreach.create({
    data: {
      campaignId: campaign.id,
      organizationSlug: orgSlug,
      outreachType: 'robocall',
      status: 'pending_payment',
      date: addDays(new Date(), 2),
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

      await webhooks.cancelNotYetDialedForDetachedPaymentMethod('pm_gone')

      const satellite = await readSatellite(outreachId)
      expect(satellite.settleState).toBe(RobocallSettleState.cancelled)
      expect(paymentIntentsCancel).toHaveBeenCalledExactlyOnceWith('pi_hold_1')
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
})
