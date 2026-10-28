import { HttpStatus } from '@nestjs/common'
import { addDays } from 'date-fns'
import type Stripe from 'stripe'
import { beforeEach, describe, expect, it, MockInstance, vi } from 'vitest'
import { useTestService } from '@/test-service'
import {
  OutreachHoldState,
  OutreachStatus,
  OutreachType,
} from '@/generated/prisma'
import {
  StripeOutreachHoldDeclinedError,
  StripeService,
} from '@/vendors/stripe/services/stripe.service'

const service = useTestService()

const CUSTOMER_ID = 'cus_card'
const OLD_CARD = 'pm_old'
const NEW_CARD = 'pm_new'

let winSlug: string
let officeSlug: string
let campaignId: number
let placeSpy: MockInstance<StripeService['createOutreachManualCaptureHold']>
let setupSpy: MockInstance<StripeService['createSetupIntent']>

const unique = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`
const winHeaders = () => ({ 'x-organization-slug': winSlug })
const serveHeaders = () => ({ 'x-organization-slug': officeSlug })

beforeEach(async () => {
  const stripe = service.app.get(StripeService)
  vi.spyOn(stripe, 'ensureCustomer').mockResolvedValue(CUSTOMER_ID)
  vi.spyOn(stripe, 'retrievePaymentMethod').mockImplementation(
    async (id: string) =>
      ({ id, customer: CUSTOMER_ID, type: 'card' }) as Stripe.PaymentMethod,
  )
  setupSpy = vi
    .spyOn(stripe, 'createSetupIntent')
    .mockResolvedValue({ clientSecret: 'seti_secret' })
  placeSpy = vi
    .spyOn(stripe, 'createOutreachManualCaptureHold')
    .mockResolvedValue({
      paymentIntentId: 'pi_card',
      captureBefore: addDays(new Date(), 7),
    })

  const suffix = unique()
  winSlug = `campaign-${suffix}`
  officeSlug = `eo-${suffix}`
  campaignId = Math.floor(Math.random() * 1_000_000) + 1000
  await service.prisma.organization.create({
    data: { slug: winSlug, ownerId: service.user.id },
  })
  await service.prisma.campaign.create({
    data: {
      id: campaignId,
      organizationSlug: winSlug,
      userId: service.user.id,
      slug: `jane-${suffix}`,
      details: { state: 'TX', zip: '78634' },
      data: {},
      aiContent: {},
    },
  })
  await service.prisma.organization.create({
    data: { slug: officeSlug, ownerId: service.user.id },
  })
  await service.prisma.electedOffice.create({
    data: {
      userId: service.user.id,
      organizationSlug: officeSlug,
      campaignId,
    },
  })
})

const createHold = async (
  scope: 'win' | 'serve',
  state: OutreachHoldState,
  daysOut: number,
): Promise<number> => {
  const outreach = await service.prisma.outreach.create({
    data: {
      ...(scope === 'win'
        ? { campaignId, organizationSlug: winSlug }
        : { organizationSlug: officeSlug }),
      outreachType: OutreachType.email,
      status: OutreachStatus.pending_payment,
      date: addDays(new Date(), daysOut),
    },
  })
  await service.prisma.outreachPaymentHold.create({
    data: {
      outreachId: outreach.id,
      channel: OutreachType.email,
      state,
      stripeCustomerId: CUSTOMER_ID,
      paymentMethodId: OLD_CARD,
      estimateCents: 5000,
      declineCode: state === OutreachHoldState.hold_failed ? 'expired' : null,
    },
  })
  return outreach.id
}

const postCard = (
  base: string,
  outreachId: number,
  paymentMethodId = NEW_CARD,
) =>
  service.client.post(
    `/v1/outreach/${base}/${outreachId}/card`,
    { paymentMethodId },
    {
      headers: base === 'holds' ? winHeaders() : serveHeaders(),
      validateStatus: () => true,
    },
  )

const readHold = (outreachId: number) =>
  service.prisma.outreachPaymentHold.findUniqueOrThrow({
    where: { outreachId },
  })

describe.each([
  { base: 'holds', scope: 'win' },
  { base: 'serve/holds', scope: 'serve' },
] as const)('$base', ({ base, scope }) => {
  it('creates a card setup intent', async () => {
    const res = await service.client.post(
      `/v1/outreach/${base}/card-intent`,
      {},
      {
        headers: scope === 'win' ? winHeaders() : serveHeaders(),
        validateStatus: () => true,
      },
    )

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data).toEqual({ clientSecret: 'seti_secret' })
    expect(setupSpy).toHaveBeenCalledWith(CUSTOMER_ID)
  })

  it('replaces the card on a scheduled send without placing a hold', async () => {
    const outreachId = await createHold(scope, OutreachHoldState.scheduled, 10)

    const res = await postCard(base, outreachId)

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data).toEqual({ outcome: 'scheduled' })
    expect(placeSpy).not.toHaveBeenCalled()
    expect((await readHold(outreachId)).paymentMethodId).toBe(NEW_CARD)
  })

  it('retries a failed hold with the new card', async () => {
    const outreachId = await createHold(scope, OutreachHoldState.hold_failed, 2)

    const res = await postCard(base, outreachId)

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.outcome).toBe('held')
    expect(typeof res.data.captureBefore).toBe('string')
    const hold = await readHold(outreachId)
    expect(hold.state).toBe(OutreachHoldState.held)
    expect(hold.paymentMethodId).toBe(NEW_CARD)
  })

  it('reports a decline with its code', async () => {
    placeSpy.mockRejectedValue(
      new StripeOutreachHoldDeclinedError('declined', 'insufficient_funds'),
    )
    const outreachId = await createHold(scope, OutreachHoldState.hold_failed, 2)

    const res = await postCard(base, outreachId)

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data).toEqual({
      outcome: 'declined',
      declineCode: 'insufficient_funds',
    })
    expect((await readHold(outreachId)).state).toBe(
      OutreachHoldState.hold_failed,
    )
  })

  it('answers 404 when there is no hold', async () => {
    const outreach = await service.prisma.outreach.create({
      data: {
        ...(scope === 'win'
          ? { campaignId, organizationSlug: winSlug }
          : { organizationSlug: officeSlug }),
        outreachType: OutreachType.email,
        status: OutreachStatus.pending_payment,
      },
    })

    const res = await postCard(base, outreach.id)

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })

  it('rejects a body without a payment method', async () => {
    const outreachId = await createHold(scope, OutreachHoldState.scheduled, 10)

    const res = await postCard(base, outreachId, '')

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
  })
})

describe('isolation between Win and Serve', () => {
  it("never changes the other product's card", async () => {
    const winId = await createHold('win', OutreachHoldState.scheduled, 10)
    const serveId = await createHold('serve', OutreachHoldState.scheduled, 10)

    const serveOnWin = await postCard('holds', serveId)
    const winOnServe = await postCard('serve/holds', winId)

    expect(serveOnWin.status).toBe(HttpStatus.NOT_FOUND)
    expect(winOnServe.status).toBe(HttpStatus.NOT_FOUND)
    expect((await readHold(winId)).paymentMethodId).toBe(OLD_CARD)
    expect((await readHold(serveId)).paymentMethodId).toBe(OLD_CARD)
  })
})

describe('scope and state', () => {
  it("answers 404 for another organization's send and leaves it alone", async () => {
    const otherSlug = `eo-other-${unique()}`
    await service.prisma.organization.create({
      data: { slug: otherSlug, ownerId: service.user.id },
    })
    const outreach = await service.prisma.outreach.create({
      data: {
        organizationSlug: otherSlug,
        outreachType: OutreachType.email,
        status: OutreachStatus.pending_payment,
        date: addDays(new Date(), 10),
      },
    })
    await service.prisma.outreachPaymentHold.create({
      data: {
        outreachId: outreach.id,
        channel: OutreachType.email,
        state: OutreachHoldState.scheduled,
        stripeCustomerId: CUSTOMER_ID,
        paymentMethodId: OLD_CARD,
        estimateCents: 5000,
      },
    })

    const win = await postCard('holds', outreach.id)
    const serve = await postCard('serve/holds', outreach.id)

    expect(win.status).toBe(HttpStatus.NOT_FOUND)
    expect(serve.status).toBe(HttpStatus.NOT_FOUND)
    expect((await readHold(outreach.id)).paymentMethodId).toBe(OLD_CARD)
  })

  it.each([OutreachHoldState.placing, OutreachHoldState.released])(
    'refuses a %s hold with 409 and keeps its card',
    async (state) => {
      const outreachId = await createHold('win', state, 2)

      const res = await postCard('holds', outreachId)

      expect(res.status).toBe(HttpStatus.CONFLICT)
      expect(placeSpy).not.toHaveBeenCalled()
      expect((await readHold(outreachId)).paymentMethodId).toBe(OLD_CARD)
    },
  )
})
