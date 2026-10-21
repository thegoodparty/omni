import { addDays, subDays } from 'date-fns'
import type Stripe from 'stripe'
import { v7 as uuidv7 } from 'uuid'
import { beforeEach, describe, expect, it, MockInstance, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { PurchaseType } from '@/payments/purchase.types'
import { QueueProducerService } from '@/queue/producer/queueProducer.service'
import { QueueType } from '@/queue/queue.types'
import { StripeService } from '@/vendors/stripe/services/stripe.service'
import { Poll, Prisma } from '../generated/prisma'

// The legacy POLL purchase type's expansion path, driven through the real
// checkout routes. Stripe and SQS are stubbed at their service seams; the poll
// row, the optimistic lock and the two fulfillment callers are real.
const service = useTestService()

const CREATE_ROUTE = '/v1/payments/purchase/create-checkout-session'
const COMPLETE_ROUTE = '/v1/payments/purchase/complete-checkout-session'
const SESSION_ID = 'cs_test_poll_expansion'
const INTENT_ID = 'pi_test_poll_expansion'
const ORIGINAL_AUDIENCE = 100
const EXPANSION_COUNT = 50

let eoOrgSlug: string
let electedOfficeId: string
let stripe: {
  createCustomCheckoutSession: ReturnType<typeof vi.spyOn>
  retrieveCheckoutSession: ReturnType<typeof vi.spyOn>
  retrievePaymentIntent: ReturnType<typeof vi.spyOn>
  updatePaymentIntentMetadata: ReturnType<typeof vi.spyOn>
  refundPaymentIntent: ReturnType<typeof vi.spyOn>
}
let sendMessage: MockInstance<QueueProducerService['sendMessage']>

const scheduledDate = () => addDays(new Date(), 5).toISOString()

const seedPoll = (overrides: Partial<Prisma.PollUncheckedCreateInput> = {}) =>
  service.prisma.poll.create({
    data: {
      name: 'Top Community Issues',
      messageContent: 'What matters most to you?',
      targetAudienceSize: ORIGINAL_AUDIENCE,
      scheduledDate: subDays(new Date(), 10),
      estimatedCompletionDate: subDays(new Date(), 7),
      isCompleted: true,
      completedDate: subDays(new Date(), 7),
      electedOfficeId,
      ...overrides,
    },
  })

const expansionMetadata = (poll: Poll) => ({
  pollPurchaseType: 'expansion',
  pollId: poll.id,
  count: EXPANSION_COUNT,
  scheduledDate: scheduledDate(),
})

const createCheckout = (metadata: Record<string, unknown>) =>
  service.client.post(
    CREATE_ROUTE,
    { type: PurchaseType.POLL, metadata },
    { headers: { 'x-organization-slug': eoOrgSlug } },
  )

// What Stripe returns for a paid expansion checkout: the session metadata
// round-trips every value as a string, with the buyer stamped server-side.
const givenPaidSession = (poll: Poll, sessionId = SESSION_ID) =>
  stripe.retrieveCheckoutSession.mockResolvedValue({
    id: sessionId,
    object: 'checkout.session',
    status: 'complete',
    payment_status: 'paid',
    payment_intent: `${INTENT_ID}_${sessionId}`,
    metadata: {
      purchaseType: PurchaseType.POLL,
      pollPurchaseType: 'expansion',
      pollId: poll.id,
      count: String(EXPANSION_COUNT),
      scheduledDate: scheduledDate(),
      userId: String(service.user.id),
    },
  } as unknown as Stripe.Response<Stripe.Checkout.Session>)

const completeCheckout = (sessionId = SESSION_ID) =>
  service.client.post(COMPLETE_ROUTE, { checkoutSessionId: sessionId })

const expansionMessages = () =>
  sendMessage.mock.calls.filter(
    ([message]) => message.type === QueueType.POLL_EXPANSION,
  )

const reloadPoll = (poll: Poll) =>
  service.prisma.poll.findUniqueOrThrow({ where: { id: poll.id } })

beforeEach(async () => {
  electedOfficeId = uuidv7()
  eoOrgSlug = `eo-${electedOfficeId}`
  await service.prisma.organization.create({
    data: { slug: eoOrgSlug, ownerId: service.user.id },
  })
  await service.prisma.electedOffice.create({
    data: {
      id: electedOfficeId,
      userId: service.user.id,
      organizationSlug: eoOrgSlug,
    },
  })

  const stripeService = service.app.get(StripeService)
  stripe = {
    createCustomCheckoutSession: vi
      .spyOn(stripeService, 'createCustomCheckoutSession')
      .mockResolvedValue({
        id: SESSION_ID,
        clientSecret: 'cs_secret_test',
        amount: 1.75,
      }),
    retrieveCheckoutSession: vi.spyOn(stripeService, 'retrieveCheckoutSession'),
    // No postPurchaseCompletedAt: neither caller has stamped the marker yet,
    // which is the window in which both of them run the handler.
    retrievePaymentIntent: vi
      .spyOn(stripeService, 'retrievePaymentIntent')
      .mockResolvedValue({
        id: INTENT_ID,
        metadata: {},
      } as unknown as Stripe.Response<Stripe.PaymentIntent>),
    updatePaymentIntentMetadata: vi
      .spyOn(stripeService, 'updatePaymentIntentMetadata')
      .mockResolvedValue({} as Stripe.Response<Stripe.PaymentIntent>),
    refundPaymentIntent: vi
      .spyOn(stripeService, 'refundPaymentIntent')
      .mockResolvedValue({
        id: 're_test_poll_expansion',
      } as Stripe.Response<Stripe.Refund>),
  }
  sendMessage = vi
    .spyOn(service.app.get(QueueProducerService), 'sendMessage')
    .mockResolvedValue(undefined)
})

describe('POST /v1/payments/purchase/create-checkout-session (poll expansion)', () => {
  it('opens a checkout for a completed poll of the buyer office', async () => {
    const poll = await seedPoll()

    const res = await createCheckout(expansionMetadata(poll))

    expect(res.status).toBe(201)
    expect(stripe.createCustomCheckoutSession).toHaveBeenCalledTimes(1)
  })

  it.each([
    {
      state: 'still running',
      overrides: { isCompleted: false, completedDate: null },
    },
    {
      state: 'scheduled and not yet sent',
      overrides: {
        isCompleted: false,
        completedDate: null,
        scheduledDate: addDays(new Date(), 3),
      },
    },
    {
      state: 'already gathering more feedback',
      overrides: {
        isCompleted: false,
        expansionCheckoutSessionId: 'cs_test_earlier_expansion',
      },
    },
  ])(
    'refuses before payment when the poll is $state',
    async ({ overrides }) => {
      const poll = await seedPoll(overrides)

      const res = await createCheckout(expansionMetadata(poll))

      expect(res.status).toBe(400)
      expect(res.data.message).toBe(
        "This poll isn't finished yet. You can gather more feedback once it is.",
      )
      expect(stripe.createCustomCheckoutSession).not.toHaveBeenCalled()
    },
  )

  it('refuses before payment when the poll belongs to another office', async () => {
    const otherUser = await service.prisma.user.create({
      data: { email: `poll-expansion-other-${uuidv7()}@example.com` },
    })
    const otherOfficeId = uuidv7()
    await service.prisma.organization.create({
      data: { slug: `eo-${otherOfficeId}`, ownerId: otherUser.id },
    })
    await service.prisma.electedOffice.create({
      data: {
        id: otherOfficeId,
        userId: otherUser.id,
        organizationSlug: `eo-${otherOfficeId}`,
      },
    })
    const poll = await seedPoll({ electedOfficeId: otherOfficeId })

    // A client-sent userId naming the owner must not stand in for the buyer.
    const res = await createCheckout({
      ...expansionMetadata(poll),
      userId: String(otherUser.id),
    })

    expect(res.status).toBe(403)
    expect(stripe.createCustomCheckoutSession).not.toHaveBeenCalled()
  })

  it('refuses before payment when the poll does not exist', async () => {
    const res = await createCheckout({
      pollPurchaseType: 'expansion',
      pollId: uuidv7(),
      count: EXPANSION_COUNT,
      scheduledDate: scheduledDate(),
    })

    expect(res.status).toBe(404)
    expect(stripe.createCustomCheckoutSession).not.toHaveBeenCalled()
  })
})

describe('POST /v1/payments/purchase/complete-checkout-session (poll expansion)', () => {
  it('expands the poll once when the browser and the webhook race', async () => {
    const poll = await seedPoll()
    givenPaidSession(poll)

    const [first, second] = await Promise.all([
      completeCheckout(),
      completeCheckout(),
    ])

    expect([first.status, second.status]).toEqual([201, 201])
    const expanded = await reloadPoll(poll)
    expect(expanded).toMatchObject({
      isCompleted: false,
      targetAudienceSize: ORIGINAL_AUDIENCE + EXPANSION_COUNT,
      expansionCheckoutSessionId: SESSION_ID,
    })
    expect(expansionMessages()).toHaveLength(1)
    expect(stripe.refundPaymentIntent).not.toHaveBeenCalled()
  })

  it('treats a second fulfillment of the same checkout as done', async () => {
    const poll = await seedPoll()
    givenPaidSession(poll)

    const first = await completeCheckout()
    const second = await completeCheckout()

    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    const expanded = await reloadPoll(poll)
    expect(expanded.targetAudienceSize).toBe(
      ORIGINAL_AUDIENCE + EXPANSION_COUNT,
    )
    expect(expansionMessages()).toHaveLength(1)
    expect(stripe.updatePaymentIntentMetadata).toHaveBeenCalledTimes(2)
    expect(stripe.refundPaymentIntent).not.toHaveBeenCalled()
  })

  it('does not expand again after the expansion it paid for completed', async () => {
    const poll = await seedPoll({ expansionCheckoutSessionId: SESSION_ID })
    givenPaidSession(poll)

    const res = await completeCheckout()

    expect(res.status).toBe(201)
    const unchanged = await reloadPoll(poll)
    expect(unchanged).toMatchObject({
      isCompleted: true,
      targetAudienceSize: ORIGINAL_AUDIENCE,
    })
    expect(expansionMessages()).toHaveLength(0)
  })

  it('refunds a second checkout paid while the first was open', async () => {
    const poll = await seedPoll()
    givenPaidSession(poll, 'cs_test_first_tab')
    expect((await completeCheckout('cs_test_first_tab')).status).toBe(201)
    givenPaidSession(poll, 'cs_test_second_tab')

    const res = await completeCheckout('cs_test_second_tab')

    expect(res.status).toBe(400)
    expect(stripe.refundPaymentIntent).toHaveBeenCalledTimes(1)
    expect(stripe.refundPaymentIntent).toHaveBeenCalledWith(
      `${INTENT_ID}_cs_test_second_tab`,
      'poll-expansion-refund-cs_test_second_tab',
    )
    const expanded = await reloadPoll(poll)
    expect(expanded).toMatchObject({
      targetAudienceSize: ORIGINAL_AUDIENCE + EXPANSION_COUNT,
      expansionCheckoutSessionId: 'cs_test_first_tab',
    })
    expect(expansionMessages()).toHaveLength(1)
  })

  it('stays retryable when the refund fails', async () => {
    const poll = await seedPoll({
      isCompleted: false,
      expansionCheckoutSessionId: 'cs_test_first_tab',
    })
    givenPaidSession(poll, 'cs_test_second_tab')
    stripe.refundPaymentIntent.mockRejectedValue(new Error('Stripe is down'))

    const res = await completeCheckout('cs_test_second_tab')

    // A 502, not a 400: the webhook rethrows it and Stripe redelivers, and the
    // refund's idempotency key makes the retry safe.
    expect(res.status).toBe(502)
    expect(stripe.updatePaymentIntentMetadata).not.toHaveBeenCalled()
  })
})
