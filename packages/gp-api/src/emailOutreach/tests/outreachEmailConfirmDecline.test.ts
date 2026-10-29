import { HttpStatus } from '@nestjs/common'
import { addDays, addHours, subMinutes } from 'date-fns'
import type Stripe from 'stripe'
import { beforeEach, describe, expect, it, MockInstance, vi } from 'vitest'
import { AnalyticsService } from '@/analytics/analytics.service'
import { PaymentHoldsService } from '@/paymentHolds/services/paymentHolds.service'
import { PaymentHoldsSweepService } from '@/paymentHolds/services/paymentHoldsSweep.service'
import { useAppEnvOverrides } from '@/shared/test-utils/appEnvOverrides'
import { useTestService } from '@/test-service'
import { EVENTS } from '@/vendors/segment/segment.types'
import {
  StripeOutreachHoldDeclinedError,
  StripeService,
} from '@/vendors/stripe/services/stripe.service'
import { OutreachHoldState, OutreachStatus } from '../../generated/prisma'
import { OutreachEmailLifecycleService } from '../services/outreachEmailLifecycle.service'
import {
  createEmailOrgs,
  createSend,
  createSender,
  EmailFixtureOrgs,
  emails,
} from './emailSendFixtures'

// The real hold module, with only Stripe stubbed: these tests are about what
// a decline at confirm leaves behind for the hold module's own sweeps.
useAppEnvOverrides({ VENDOR_CRONS_ENABLED: true })

const service = useTestService()

const CUSTOMER_ID = 'cus_decline'
const BAD_CARD = 'pm_declined'
const GOOD_CARD = 'pm_good'

let orgs: EmailFixtureOrgs
let placeSpy: MockInstance<StripeService['createOutreachManualCaptureHold']>
let track: MockInstance<AnalyticsService['track']>

beforeEach(async () => {
  const stripe = service.app.get(StripeService)
  vi.spyOn(stripe, 'ensureCustomer').mockResolvedValue(CUSTOMER_ID)
  vi.spyOn(stripe, 'retrievePaymentMethod').mockImplementation(
    async (id: string) =>
      ({ id, customer: CUSTOMER_ID, type: 'card' }) as Stripe.PaymentMethod,
  )
  vi.spyOn(stripe, 'cancelHold').mockResolvedValue(undefined)
  placeSpy = vi
    .spyOn(stripe, 'createOutreachManualCaptureHold')
    .mockImplementation(async ({ paymentMethodId }) => {
      if (paymentMethodId === BAD_CARD) {
        throw new StripeOutreachHoldDeclinedError(
          'Your card has insufficient funds.',
          'insufficient_funds',
        )
      }
      return {
        paymentIntentId: `pi_${paymentMethodId}`,
        captureBefore: addDays(new Date(), 6),
      }
    })
  track = vi
    .spyOn(service.app.get(AnalyticsService), 'track')
    .mockImplementation(async () => undefined as never)
  orgs = await createEmailOrgs(service.prisma, service.user.id)
})

const winHeaders = () => ({ 'x-organization-slug': orgs.winSlug })

const confirm = (outreachId: number, paymentMethodId: string) =>
  service.client.post(
    `/v1/outreach/email/${outreachId}/confirm`,
    { paymentMethodId },
    { headers: winHeaders(), validateStatus: () => true },
  )

const winSend = async (date: Date | null, recipients = 3) => {
  const sender = await createSender(service.prisma, orgs.winSlug)
  return createSend(service.prisma, {
    organizationSlug: orgs.winSlug,
    campaignId: orgs.campaignId,
    senderId: sender.id,
    emails: emails(recipients),
    date,
  })
}

const sendState = async (outreachId: number) => {
  const outreach = await service.prisma.outreach.findUniqueOrThrow({
    where: { id: outreachId },
    include: { email: true, paymentHold: true },
  })
  return {
    status: outreach.status,
    date: outreach.date,
    recipientCap: outreach.email?.recipientCap ?? null,
    hold: outreach.paymentHold,
  }
}

describe('a card declined at confirm', () => {
  it('leaves a send-now email a draft and answers 402', async () => {
    const { outreachId } = await winSend(null)

    const res = await confirm(outreachId, BAD_CARD)

    expect(res.status).toBe(HttpStatus.PAYMENT_REQUIRED)
    expect(res.data).toMatchObject({ declineCode: 'insufficient_funds' })
    expect(typeof res.data.message).toBe('string')
    expect(placeSpy).toHaveBeenCalledWith(
      expect.objectContaining({ offSession: false, holdAttempt: 0 }),
    )
    const state = await sendState(outreachId)
    expect(state).toMatchObject({
      status: OutreachStatus.draft,
      date: null,
      recipientCap: null,
    })
    expect(state.hold).toMatchObject({
      state: OutreachHoldState.hold_failed,
      holdAttempt: 1,
      paymentIntentId: null,
    })
    expect(track).not.toHaveBeenCalled()

    const draft = await service.client.get(`/v1/outreach/email/${outreachId}`, {
      headers: winHeaders(),
    })
    expect(draft.data.status).toBe('draft')
    expect(draft.data.estimate).not.toBeNull()
  })

  it('holds and schedules on a second confirm with a good card', async () => {
    const { outreachId } = await winSend(null)
    await confirm(outreachId, BAD_CARD)

    const res = await confirm(outreachId, GOOD_CARD)

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data).toMatchObject({
      outcome: 'held',
      email: { status: 'pending', recipientCap: 3 },
    })
    expect(placeSpy).toHaveBeenCalledTimes(2)
    expect(placeSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        paymentMethodId: GOOD_CARD,
        holdAttempt: 1,
        offSession: false,
        amountInCents: 50,
      }),
    )
    const state = await sendState(outreachId)
    expect(state.status).toBe(OutreachStatus.pending)
    expect(state.date?.getTime()).toBeGreaterThan(Date.now())
    expect(state.hold).toMatchObject({
      state: OutreachHoldState.held,
      paymentIntentId: `pi_${GOOD_CARD}`,
      paymentMethodId: GOOD_CARD,
      authorizedCents: 50,
      declineCode: null,
    })
    expect(track).toHaveBeenCalledTimes(1)
    expect(track).toHaveBeenCalledWith(
      service.user.id,
      EVENTS.Email.SendCompleted,
      expect.objectContaining({ recipientCap: 3, priceCents: 50 }),
    )
  })

  it('holds the price the second confirm froze', async () => {
    const { outreachId, outreachEmailId } = await winSend(null, 60)
    await confirm(outreachId, BAD_CARD)
    expect(placeSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ amountInCents: 60 }),
    )
    const outreachEmail = await service.prisma.outreachEmail.findUniqueOrThrow({
      where: { id: outreachEmailId },
    })
    await service.prisma.outreachEmailRecipient.createMany({
      data: emails(20, 'example.org').map((email) => ({
        outreachEmailId,
        senderId: outreachEmail.senderId,
        email,
      })),
    })

    const res = await confirm(outreachId, GOOD_CARD)

    expect(res.data.email.recipientCap).toBe(80)
    expect(placeSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ amountInCents: 80 }),
    )
    expect((await sendState(outreachId)).hold).toMatchObject({
      estimateCents: 80,
      authorizedCents: 80,
    })
  })

  it('leaves nothing the hold or send sweeps act on', async () => {
    const sendAt = addHours(new Date(), 6)
    const { outreachId } = await winSend(sendAt)
    await confirm(outreachId, BAD_CARD)
    expect((await sendState(outreachId)).date).toEqual(sendAt)

    const holds = service.app.get(PaymentHoldsService)
    await holds.retryHoldFailedForAttachedCard(CUSTOMER_ID, GOOD_CARD)
    const sweeps = service.app.get(PaymentHoldsSweepService)
    await service.prisma.outreachPaymentHold.update({
      where: { outreachId },
      data: { updatedAt: subMinutes(new Date(), 60 * 24) },
    })
    await sweeps.remindFailedHolds()

    // The draft's send time passes with no one confirming it.
    await service.prisma.outreach.update({
      where: { id: outreachId },
      data: { date: subMinutes(new Date(), 5) },
    })
    await sweeps.releaseUnpaidHolds()
    await sweeps.sweepPlacements()
    await service.app.get(OutreachEmailLifecycleService).startDueSends()

    expect(placeSpy).toHaveBeenCalledTimes(1)
    expect(track).not.toHaveBeenCalled()
    const state = await sendState(outreachId)
    expect(state.status).toBe(OutreachStatus.draft)
    expect(state.hold).toMatchObject({
      state: OutreachHoldState.hold_failed,
      paymentIntentId: null,
    })
    expect(await service.prisma.outreachOrphanedHold.count()).toBe(0)
  })

  it("refuses the hold's card route for a draft", async () => {
    const { outreachId } = await winSend(null)
    await confirm(outreachId, BAD_CARD)

    const res = await service.client.post(
      `/v1/outreach/holds/${outreachId}/card`,
      { paymentMethodId: GOOD_CARD },
      { headers: winHeaders(), validateStatus: () => true },
    )

    expect(res.status).toBe(HttpStatus.CONFLICT)
    expect(placeSpy).toHaveBeenCalledTimes(1)
  })
})

describe('a send more than 3 days out', () => {
  it('is scheduled at confirm without placing a hold', async () => {
    const sendAt = addDays(new Date(), 5)
    const { outreachId } = await winSend(sendAt)

    const res = await confirm(outreachId, GOOD_CARD)

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data).toMatchObject({
      outcome: 'scheduled',
      email: { status: 'pending' },
    })
    expect(placeSpy).not.toHaveBeenCalled()
    const state = await sendState(outreachId)
    expect(state.date).toEqual(sendAt)
    expect(state.hold).toMatchObject({
      state: OutreachHoldState.scheduled,
      paymentMethodId: GOOD_CARD,
      holdAttempt: 0,
    })
    expect(track).toHaveBeenCalledWith(
      service.user.id,
      EVENTS.Email.SendCompleted,
      expect.anything(),
    )
  })
})
