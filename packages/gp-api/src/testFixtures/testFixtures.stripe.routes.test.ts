import { PaymentEventsService } from '@/payments/services/paymentEventsService'
import { StripeService } from '@/vendors/stripe/services/stripe.service'
import { useTestService } from '@/test-service'
import Stripe from 'stripe'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Route-level coverage for POST /v1/test-fixtures/vendor-mocks/stripe/events.
// The fixture endpoint retrieves a checkout session from Stripe, wraps it in a
// Stripe.Event, and calls PaymentEventsService.handleEvent in-process so
// Playwright specs can deliver signed checkout.session.completed events to a
// preview environment without a public Stripe webhook target.
//
// The test verifies the plumbing — right event type delivered to handleEvent,
// correct response shape — rather than re-testing payment-handler business
// logic, which paymentEvents.cancellation.routes.test.ts already covers.

const service = useTestService()

const FIXTURE_ROUTE = '/v1/test-fixtures/vendor-mocks/stripe/events'
const FAKE_SESSION_ID = 'cs_test_fixture_abc123'

// A minimal checkout.session.completed session object whose shape satisfies
// the handler's mode-dispatch (it just reads session.mode and routes).
const fakeSession = {
  id: FAKE_SESSION_ID,
  object: 'checkout.session',
  mode: 'payment',
  payment_status: 'paid',
  status: 'complete',
  metadata: { userId: String(123) },
  customer: null,
  subscription: null,
  amount_total: 5000,
  currency: 'usd',
} as unknown as Stripe.Checkout.Session

describe('POST /v1/test-fixtures/vendor-mocks/stripe/events', () => {
  let handleEvent: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.spyOn(
      service.app.get(StripeService),
      'retrieveCheckoutSession',
    ).mockResolvedValue(fakeSession)

    handleEvent = vi
      .spyOn(
        service.app.get(PaymentEventsService, { strict: false }),
        'handleEvent',
      )
      .mockResolvedValue(undefined)
  })

  it('delivers a checkout.session.completed event and returns delivered status', async () => {
    const res = await service.client.post(FIXTURE_ROUTE, {
      type: 'checkout.session.completed',
      sessionId: FAKE_SESSION_ID,
    })

    expect(res.status).toBe(201)
    expect(res.data).toMatchObject({
      status: 'delivered',
      eventId: expect.stringMatching(/^evt_fixture_/),
    })
  })

  it('calls PaymentEventsService.handleEvent with checkout.session.completed', async () => {
    await service.client.post(FIXTURE_ROUTE, {
      type: 'checkout.session.completed',
      sessionId: FAKE_SESSION_ID,
    })

    expect(handleEvent).toHaveBeenCalledOnce()
    const [event] = handleEvent.mock.calls[0]
    expect((event as Stripe.Event).type).toBe('checkout.session.completed')
    expect((event as Stripe.CheckoutSessionCompletedEvent).data.object.id).toBe(
      FAKE_SESSION_ID,
    )
  })

  it('retrieves the session by sessionId', async () => {
    const retrieveSpy = vi.spyOn(
      service.app.get(StripeService),
      'retrieveCheckoutSession',
    )

    await service.client.post(FIXTURE_ROUTE, {
      type: 'checkout.session.completed',
      sessionId: FAKE_SESSION_ID,
    })

    expect(retrieveSpy).toHaveBeenCalledWith(FAKE_SESSION_ID)
  })

  it('returns 404 outside non-prod deploys', async () => {
    const original = process.env.OTEL_SERVICE_ENVIRONMENT
    process.env.OTEL_SERVICE_ENVIRONMENT = 'prod'
    try {
      const res = await service.client.post(
        FIXTURE_ROUTE,
        { type: 'checkout.session.completed', sessionId: FAKE_SESSION_ID },
        { validateStatus: () => true },
      )
      expect(res.status).toBe(404)
    } finally {
      process.env.OTEL_SERVICE_ENVIRONMENT = original
    }
  })

  it('returns 403 for a non-test user', async () => {
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { email: 'notatest@example.com' },
    })
    const res = await service.client.post(
      FIXTURE_ROUTE,
      { type: 'checkout.session.completed', sessionId: FAKE_SESSION_ID },
      { validateStatus: () => true },
    )
    expect(res.status).toBe(403)
  })
})
