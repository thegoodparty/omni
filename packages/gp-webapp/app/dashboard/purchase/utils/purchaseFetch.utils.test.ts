import { describe, it, expect } from 'vitest'
import { http, HttpResponse } from 'msw'
import { api, mswServer } from 'helpers/test-utils/api-mocking'
import {
  createCheckoutSession,
  createProSubscriptionCheckoutSession,
  completeCheckoutSession,
  completeFreePurchase,
} from './purchaseFetch.utils'

describe('purchaseFetch.utils', () => {
  describe('createCheckoutSession', () => {
    it('resolves ok with the session payload and sends receiptEmail + allowPromoCodes default', async () => {
      let requestBody: Record<string, unknown> | undefined

      mswServer.use(
        http.post(
          '/api/v1/payments/purchase/create-checkout-session',
          async ({ request }) => {
            requestBody = (await request.json()) as Record<string, unknown>
            return HttpResponse.json(
              { id: 'cs_1', clientSecret: 'secret', amount: 500 },
              { status: 200 },
            )
          },
        ),
      )

      const response = await createCheckoutSession(
        'domain_registration',
        { domainName: 'x.com' },
        'a@b.c',
        '/return',
      )

      expect(response.ok).toBe(true)
      expect(response.data).toEqual({
        id: 'cs_1',
        clientSecret: 'secret',
        amount: 500,
      })
      expect(requestBody?.receiptEmail).toBe('a@b.c')
      expect(requestBody?.allowPromoCodes).toBe(true)
    })

    it('omits the receiptEmail key entirely when none is provided', async () => {
      let requestBody: Record<string, unknown> | undefined

      mswServer.use(
        http.post(
          '/api/v1/payments/purchase/create-checkout-session',
          async ({ request }) => {
            requestBody = (await request.json()) as Record<string, unknown>
            return HttpResponse.json(
              { id: 'cs_1', clientSecret: 'secret', amount: 500 },
              { status: 200 },
            )
          },
        ),
      )

      await createCheckoutSession('domain_registration', {
        domainName: 'x.com',
      })

      expect(requestBody).not.toHaveProperty('receiptEmail')
    })

    it('resolves (does not reject) with ok: false on a 500 response — legacy no-throw contract', async () => {
      mswServer.use(
        http.post('/api/v1/payments/purchase/create-checkout-session', () =>
          HttpResponse.json({ error: 'boom' }, { status: 500 }),
        ),
      )

      // characterizes current behavior; see plans/003 report
      const response = await createCheckoutSession('domain_registration', {
        domainName: 'x.com',
      })

      expect(response.ok).toBe(false)
      expect(response.status).toBe(500)
    })
  })

  describe('completeCheckoutSession', () => {
    it('resolves ok on 200', async () => {
      mswServer.use(
        http.post('/api/v1/payments/purchase/complete-checkout-session', () =>
          HttpResponse.json({ success: true }, { status: 200 }),
        ),
      )

      const response = await completeCheckoutSession('cs_1')

      expect(response.ok).toBe(true)
      expect(response.data).toEqual({ success: true })
    })
  })

  describe('completeFreePurchase', () => {
    it('resolves ok on 200', async () => {
      mswServer.use(
        http.post('/api/v1/payments/purchase/complete-free-purchase', () =>
          HttpResponse.json({ success: true }, { status: 200 }),
        ),
      )

      const response = await completeFreePurchase('domain_registration', {
        domainName: 'x.com',
      })

      expect(response.ok).toBe(true)
      expect(response.data).toEqual({ success: true })
    })

    it('resolves (does not reject) with ok: false on a 400 response', async () => {
      mswServer.use(
        http.post('/api/v1/payments/purchase/complete-free-purchase', () =>
          HttpResponse.json({ error: 'bad request' }, { status: 400 }),
        ),
      )

      // characterizes current behavior; see plans/003 report
      const response = await completeFreePurchase('domain_registration', {
        domainName: 'x.com',
      })

      expect(response.ok).toBe(false)
      expect(response.status).toBe(400)
    })
  })

  describe('createProSubscriptionCheckoutSession', () => {
    it('resolves the clientSecret from the typed route', async () => {
      api.mock('POST /v1/payments/purchase/checkout-session', {
        status: 200,
        data: { clientSecret: 'sec' },
      })

      const result = await createProSubscriptionCheckoutSession('/return')

      expect(result).toEqual({ clientSecret: 'sec' })
    })

    it('rejects with a descriptive error when clientSecret is missing', async () => {
      api.mock('POST /v1/payments/purchase/checkout-session', {
        status: 200,
        data: {},
      })

      await expect(
        createProSubscriptionCheckoutSession('/return'),
      ).rejects.toThrow('Missing client secret for Pro subscription checkout')
    })

    it('rejects on a non-2xx response — typed client throws on non-2xx', async () => {
      api.mock('POST /v1/payments/purchase/checkout-session', {
        status: 500,
        data: {},
      })

      // characterizes current behavior; see plans/003 report
      await expect(
        createProSubscriptionCheckoutSession('/return'),
      ).rejects.toThrow()
    })
  })
})
