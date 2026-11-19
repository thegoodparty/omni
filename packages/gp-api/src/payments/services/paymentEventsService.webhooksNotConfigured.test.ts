import { BadRequestException } from '@nestjs/common'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import Stripe from 'stripe'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebhookEventType } from '../payments.types'
// Load the service graph once up front. Importing it for the first time
// under the doMock below never settles and the test times out.
import './paymentEventsService'

describe('PaymentEventsService when Stripe webhooks are not configured', () => {
  afterEach(() => {
    vi.resetModules()
    vi.doUnmock('../../shared/env/env')
  })

  it('logs once on construction and handleEvent throws instead of processing', async () => {
    // Mock the resolution helper rather than unsetting the real env var:
    // stripe.service.ts's own (out-of-scope) module-level requireEnv() call
    // on the same var would otherwise crash this fresh import.
    vi.doMock('../../shared/env/env', async (importOriginal) => {
      const actual =
        await importOriginal<typeof import('../../shared/env/env')>()
      return {
        ...actual,
        resolveEnvVar: (name: string) =>
          name === 'STRIPE_WEBSOCKET_SECRET'
            ? { configured: false }
            : actual.resolveEnvVar(name),
      }
    })
    vi.resetModules()
    const { PaymentEventsService: PES } =
      await import('./paymentEventsService.js')
    const disabledLogger = createMockLogger()
    const service = new PES(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      disabledLogger,
    )

    expect(disabledLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Stripe webhooks are disabled'),
    )
    await expect(
      service.handleEvent({
        type: WebhookEventType.CheckoutSessionCompleted,
      } as Stripe.Event),
    ).rejects.toBeInstanceOf(BadRequestException)
  })
})
