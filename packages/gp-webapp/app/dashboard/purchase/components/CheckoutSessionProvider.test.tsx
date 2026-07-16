import { describe, it, expect, vi, beforeEach } from 'vitest'
import { http, HttpResponse, delay } from 'msw'
import { act } from '@testing-library/react'
import { mswServer } from 'helpers/test-utils/api-mocking'
import { render } from 'helpers/test-utils/render'
import { PURCHASE_TYPES } from 'helpers/purchaseTypes'
import {
  CheckoutSessionProvider,
  useCheckoutSession,
  CheckoutSessionContextValue,
} from './CheckoutSessionProvider'

const { reportErrorToSentryMock } = vi.hoisted(() => ({
  reportErrorToSentryMock: vi.fn(),
}))

vi.mock('app/shared/sentry', () => ({
  reportErrorToSentry: reportErrorToSentryMock,
}))

const LEGACY_URL = '/api/v1/payments/purchase/create-checkout-session'

const captureContext = (ref: {
  current: CheckoutSessionContextValue | null
}) => {
  const Probe = () => {
    ref.current = useCheckoutSession()
    return null
  }
  return Probe
}

describe('CheckoutSessionProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('caches the resolved clientSecret and only hits the network once', async () => {
    let hits = 0
    mswServer.use(
      http.post(LEGACY_URL, () => {
        hits += 1
        return HttpResponse.json(
          { id: 'cs_1', clientSecret: 'secret-1', amount: 500 },
          { status: 200 },
        )
      }),
    )

    const ref: { current: CheckoutSessionContextValue | null } = {
      current: null,
    }
    const Probe = captureContext(ref)

    render(
      <CheckoutSessionProvider type={PURCHASE_TYPES.DOMAIN_REGISTRATION}>
        <Probe />
      </CheckoutSessionProvider>,
    )

    let first = ''
    await act(async () => {
      first = await ref.current!.fetchClientSecret()
    })
    // ref.current is re-captured above after the state update settles, so
    // this second call reads the just-updated `checkoutSession` and takes
    // the cache-hit branch instead of firing a second request.
    const second = await ref.current!.fetchClientSecret()

    expect(first).toBe('secret-1')
    expect(second).toBe('secret-1')
    expect(hits).toBe(1)
  })

  it('dedupes two concurrent in-flight calls into a single network request', async () => {
    let hits = 0
    mswServer.use(
      http.post(LEGACY_URL, async () => {
        hits += 1
        await delay(50)
        return HttpResponse.json(
          { id: 'cs_1', clientSecret: 'secret-1', amount: 500 },
          { status: 200 },
        )
      }),
    )

    const ref: { current: CheckoutSessionContextValue | null } = {
      current: null,
    }
    const Probe = captureContext(ref)

    render(
      <CheckoutSessionProvider type={PURCHASE_TYPES.DOMAIN_REGISTRATION}>
        <Probe />
      </CheckoutSessionProvider>,
    )

    let first = ''
    let second = ''
    await act(async () => {
      ;[first, second] = await Promise.all([
        ref.current!.fetchClientSecret(),
        ref.current!.fetchClientSecret(),
      ])
    })

    expect(first).toBe('secret-1')
    expect(second).toBe('secret-1')
    expect(hits).toBe(1)
  })

  it('rejects with "Invalid purchase type" when type is not recognized and no createSession is injected', async () => {
    const ref: { current: CheckoutSessionContextValue | null } = {
      current: null,
    }
    const Probe = captureContext(ref)

    render(
      <CheckoutSessionProvider type="not_a_type">
        <Probe />
      </CheckoutSessionProvider>,
    )

    await act(async () => {
      await expect(ref.current!.fetchClientSecret()).rejects.toThrow(
        'Invalid purchase type',
      )
    })
    expect(reportErrorToSentryMock).toHaveBeenCalled()
  })

  it('surfaces the nested legacy error message on a non-ok response', async () => {
    mswServer.use(
      http.post(LEGACY_URL, () =>
        HttpResponse.json(
          { data: { error: 'Card country mismatch' } },
          { status: 400 },
        ),
      ),
    )

    const ref: { current: CheckoutSessionContextValue | null } = {
      current: null,
    }
    const Probe = captureContext(ref)

    render(
      <CheckoutSessionProvider type={PURCHASE_TYPES.DOMAIN_REGISTRATION}>
        <Probe />
      </CheckoutSessionProvider>,
    )

    await act(async () => {
      await expect(ref.current!.fetchClientSecret()).rejects.toThrow(
        'Card country mismatch',
      )
    })
    expect(ref.current!.error).toBe('Card country mismatch')
    expect(reportErrorToSentryMock).toHaveBeenCalled()
  })

  it('falls back to a generic error message on a non-ok response without the nested error shape', async () => {
    mswServer.use(
      http.post(LEGACY_URL, () =>
        HttpResponse.json({ message: 'nope' }, { status: 400 }),
      ),
    )

    const ref: { current: CheckoutSessionContextValue | null } = {
      current: null,
    }
    const Probe = captureContext(ref)

    render(
      <CheckoutSessionProvider type={PURCHASE_TYPES.DOMAIN_REGISTRATION}>
        <Probe />
      </CheckoutSessionProvider>,
    )

    await act(async () => {
      await expect(ref.current!.fetchClientSecret()).rejects.toThrow(
        'Failed to create checkout session',
      )
    })
    expect(ref.current!.error).toBe('Failed to create checkout session')
  })

  it('uses an injected createSession and never calls the legacy URL', async () => {
    let legacyHits = 0
    mswServer.use(
      http.post(LEGACY_URL, () => {
        legacyHits += 1
        return HttpResponse.json(
          { id: 'cs_1', clientSecret: 'legacy-secret', amount: 500 },
          { status: 200 },
        )
      }),
    )

    const createSession = vi.fn().mockResolvedValue({
      clientSecret: 'injected-secret',
    })

    const ref: { current: CheckoutSessionContextValue | null } = {
      current: null,
    }
    const Probe = captureContext(ref)

    render(
      <CheckoutSessionProvider createSession={createSession}>
        <Probe />
      </CheckoutSessionProvider>,
    )

    let secret = ''
    await act(async () => {
      secret = await ref.current!.fetchClientSecret()
    })

    expect(secret).toBe('injected-secret')
    expect(legacyHits).toBe(0)
  })

  it('rejects and surfaces the message when an injected createSession throws', async () => {
    const createSession = vi.fn().mockRejectedValue(new Error('boom'))

    const ref: { current: CheckoutSessionContextValue | null } = {
      current: null,
    }
    const Probe = captureContext(ref)

    render(
      <CheckoutSessionProvider createSession={createSession}>
        <Probe />
      </CheckoutSessionProvider>,
    )

    await act(async () => {
      await expect(ref.current!.fetchClientSecret()).rejects.toThrow('boom')
    })
    expect(ref.current!.error).toBe('boom')
    expect(reportErrorToSentryMock).toHaveBeenCalled()
  })

  it('throws when useCheckoutSession is used outside a CheckoutSessionProvider', () => {
    const Probe = () => {
      useCheckoutSession()
      return null
    }

    expect(() => render(<Probe />)).toThrow(
      'useCheckoutSession must be used within a CheckoutSessionProvider',
    )
  })
})
