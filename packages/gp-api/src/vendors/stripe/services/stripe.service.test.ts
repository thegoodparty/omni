import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { BadGatewayException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { firstOrThrow, nthOrThrow } from 'src/shared/test-utils/arrays.util'
import { SlackService } from 'src/vendors/slack/services/slack.service'
import { UsersService } from 'src/users/services/users.service'
import { StripeService } from './stripe.service'

const {
  sessionsCreate,
  sessionsExpire,
  sessionsRetrieve,
  productsRetrieve,
  MockStripeError,
} = vi.hoisted(() => ({
  sessionsCreate: vi.fn(),
  sessionsExpire: vi.fn(),
  sessionsRetrieve: vi.fn(),
  productsRetrieve: vi.fn(),
  MockStripeError: class StripeInvalidRequestError extends Error {},
}))

vi.mock('stripe', () => ({
  default: class {
    static errors = { StripeInvalidRequestError: MockStripeError }
    checkout = {
      sessions: {
        create: sessionsCreate,
        expire: sessionsExpire,
        retrieve: sessionsRetrieve,
      },
    }
    products = { retrieve: productsRetrieve }
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
