import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { BadGatewayException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { firstOrThrow, nthOrThrow } from 'src/shared/test-utils/arrays.util'
import { SlackService } from 'src/vendors/slack/services/slack.service'
import { UsersService } from 'src/users/services/users.service'
import { StripeChargeDeclinedError, StripeService } from './stripe.service'

const {
  sessionsCreate,
  sessionsExpire,
  sessionsRetrieve,
  productsRetrieve,
  paymentIntentsCreate,
  MockStripeError,
  MockStripeCardError,
} = vi.hoisted(() => ({
  sessionsCreate: vi.fn(),
  sessionsExpire: vi.fn(),
  sessionsRetrieve: vi.fn(),
  productsRetrieve: vi.fn(),
  paymentIntentsCreate: vi.fn(),
  MockStripeError: class StripeInvalidRequestError extends Error {},
  MockStripeCardError: class StripeCardError extends Error {
    payment_intent?: { id: string }
    constructor(message: string, paymentIntentId?: string) {
      super(message)
      if (paymentIntentId) this.payment_intent = { id: paymentIntentId }
    }
  },
}))

vi.mock('stripe', () => ({
  default: class {
    static errors = {
      StripeInvalidRequestError: MockStripeError,
      StripeCardError: MockStripeCardError,
    }
    checkout = {
      sessions: {
        create: sessionsCreate,
        expire: sessionsExpire,
        retrieve: sessionsRetrieve,
      },
    }
    products = { retrieve: productsRetrieve }
    paymentIntents = { create: paymentIntentsCreate }
  },
}))

const userId = 7
const email = 'buyer@example.com'
const priceId = 'price_test_pro'

describe('StripeService Pro subscription checkout', () => {
  let service: StripeService

  beforeEach(() => {
    productsRetrieve.mockResolvedValue({ default_price: priceId })
    service = new StripeService(
      {} as unknown as SlackService,
      {} as unknown as UsersService,
      createMockLogger(),
    )
  })

  describe('createEmbeddedProSubscriptionCheckoutSession', () => {
    it('builds an embedded subscription session and returns the client_secret', async () => {
      sessionsCreate.mockResolvedValue({
        id: 'cs_test_embedded',
        client_secret: 'cs_test_embedded_secret_abc',
      })

      const result = await service.createEmbeddedProSubscriptionCheckoutSession(
        userId,
        email,
        'https://app.test/dashboard/pro-upgrade?session_id={CHECKOUT_SESSION_ID}',
      )

      const args = firstOrThrow(sessionsCreate.mock.calls)[0]
      expect(args.ui_mode).toBe('custom')
      expect(args.mode).toBe('subscription')
      expect(args.return_url).toBe(
        'https://app.test/dashboard/pro-upgrade?session_id={CHECKOUT_SESSION_ID}',
      )
      expect(args.success_url).toBeUndefined()
      expect(args.metadata).toEqual({ userId })
      expect(args.line_items).toEqual([{ price: priceId, quantity: 1 }])

      expect(result).toEqual({
        clientSecret: 'cs_test_embedded_secret_abc',
        checkoutSessionId: 'cs_test_embedded',
      })
    })

    it('throws BadGatewayException when Stripe returns no client_secret', async () => {
      sessionsCreate.mockResolvedValue({
        id: 'cs_test_embedded',
        client_secret: null,
      })

      await expect(
        service.createEmbeddedProSubscriptionCheckoutSession(userId, email),
      ).rejects.toThrow(BadGatewayException)
    })

    it('carries the same userId metadata as the redirect subscription session', async () => {
      sessionsCreate.mockResolvedValue({
        id: 'cs_test',
        client_secret: 'cs_test_secret',
        url: 'https://stripe.test/checkout',
      })

      await service.createCheckoutSession(userId, email)
      const redirectArgs = firstOrThrow(sessionsCreate.mock.calls)[0]

      await service.createEmbeddedProSubscriptionCheckoutSession(userId, email)
      const embeddedArgs = nthOrThrow(sessionsCreate.mock.calls, 1)[0]

      expect(embeddedArgs.metadata).toEqual(redirectArgs.metadata)
      expect(embeddedArgs.mode).toBe(redirectArgs.mode)
      expect(embeddedArgs.line_items).toEqual(redirectArgs.line_items)
    })
  })

  describe('expireCheckoutSession', () => {
    it('expires an open session and reports it expired', async () => {
      sessionsExpire.mockResolvedValue({ id: 'cs_open', status: 'expired' })

      await expect(service.expireCheckoutSession('cs_open')).resolves.toBe(
        'expired',
      )
      expect(sessionsExpire).toHaveBeenCalledWith('cs_open')
      expect(sessionsRetrieve).not.toHaveBeenCalled()
    })

    it('reports complete when the non-open session was already paid', async () => {
      sessionsExpire.mockRejectedValue(
        new MockStripeError('This session is already complete'),
      )
      sessionsRetrieve.mockResolvedValue({
        id: 'cs_completed',
        status: 'complete',
      })

      await expect(service.expireCheckoutSession('cs_completed')).resolves.toBe(
        'complete',
      )
    })

    it('reports expired when the non-open session had already expired', async () => {
      sessionsExpire.mockRejectedValue(
        new MockStripeError('This session is already expired'),
      )
      sessionsRetrieve.mockResolvedValue({
        id: 'cs_stale',
        status: 'expired',
      })

      await expect(service.expireCheckoutSession('cs_stale')).resolves.toBe(
        'expired',
      )
    })

    it('reports expired when the session does not exist on this Stripe key', async () => {
      sessionsExpire.mockRejectedValue(new MockStripeError('No such session'))
      sessionsRetrieve.mockRejectedValue(new MockStripeError('No such session'))

      await expect(service.expireCheckoutSession('cs_other_env')).resolves.toBe(
        'expired',
      )
    })

    it('throws BadGatewayException when expiry fails for another reason', async () => {
      sessionsExpire.mockRejectedValue(new Error('stripe unavailable'))

      await expect(service.expireCheckoutSession('cs_open')).rejects.toThrow(
        BadGatewayException,
      )
    })

    it('throws BadGatewayException when the status lookup fails for another reason', async () => {
      sessionsExpire.mockRejectedValue(new MockStripeError('not open'))
      sessionsRetrieve.mockRejectedValue(new Error('stripe unavailable'))

      await expect(service.expireCheckoutSession('cs_open')).rejects.toThrow(
        BadGatewayException,
      )
    })
  })
})

describe('StripeService.createOffSessionCharge', () => {
  let service: StripeService

  beforeEach(() => {
    service = new StripeService(
      {} as unknown as SlackService,
      {} as unknown as UsersService,
      createMockLogger(),
    )
  })

  const chargeArgs = {
    customerId: 'cus_1',
    paymentMethodId: 'pm_1',
    amountInCents: 450,
    robocallId: 42,
    metadata: { outreachId: '42' },
  }

  it('charges off-session with a stable idempotency key and returns the intent id', async () => {
    paymentIntentsCreate.mockResolvedValue({ id: 'pi_ok', status: 'succeeded' })

    const result = await service.createOffSessionCharge(chargeArgs)

    expect(result).toEqual({ paymentIntentId: 'pi_ok' })
    const [body, opts] = firstOrThrow(paymentIntentsCreate.mock.calls)
    expect(body).toMatchObject({
      amount: 450,
      customer: 'cus_1',
      payment_method: 'pm_1',
      capture_method: 'automatic',
      confirm: true,
      off_session: true,
    })
    // Stable per outreach so a retry replays instead of double-charging.
    expect(opts).toEqual({ idempotencyKey: 'robocall-fresh-charge-42' })
  })

  it('maps a card decline to StripeChargeDeclinedError carrying the PI id', async () => {
    paymentIntentsCreate.mockRejectedValue(
      new MockStripeCardError('card_declined', 'pi_declined'),
    )

    await expect(
      service.createOffSessionCharge(chargeArgs),
    ).rejects.toMatchObject({
      name: 'StripeChargeDeclinedError',
      paymentIntentId: 'pi_declined',
    })
  })

  it('treats a confirmed-but-not-succeeded PI as a decline (never a false charge)', async () => {
    paymentIntentsCreate.mockResolvedValue({
      id: 'pi_pending',
      status: 'requires_action',
    })

    await expect(
      service.createOffSessionCharge(chargeArgs),
    ).rejects.toBeInstanceOf(StripeChargeDeclinedError)
  })

  it('maps a non-card Stripe failure to a 502', async () => {
    paymentIntentsCreate.mockRejectedValue(new Error('stripe down'))

    await expect(
      service.createOffSessionCharge(chargeArgs),
    ).rejects.toBeInstanceOf(BadGatewayException)
  })
})
