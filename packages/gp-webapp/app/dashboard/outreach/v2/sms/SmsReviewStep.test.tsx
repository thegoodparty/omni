import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { http, HttpResponse } from 'msw'
import { render } from 'helpers/test-utils/render'
import { mswServer } from 'helpers/test-utils/api-mocking'
import { SmsReviewStep } from './SmsReviewStep'

// What the mocked Stripe form reports as its live total once mounted; null
// means Stripe has not priced the session yet. `providerError` stands in for
// the session provider's error slot, which the real CheckoutForm sets
// alongside its onError callback.
const { live, providerError } = vi.hoisted(() => {
  const listeners = new Set<() => void>()
  const providerError = {
    value: null as string | null,
    set: (next: string | null) => {
      providerError.value = next
      listeners.forEach((notify) => notify())
    },
    subscribe: (notify: () => void) => {
      listeners.add(notify)
      return () => listeners.delete(notify)
    },
  }
  return { live: { dollars: null as number | null }, providerError }
})

const DECLINE = 'Your card has insufficient funds. Try a different card.'

vi.mock('app/dashboard/purchase/components/CheckoutPayment', async () => {
  const { useEffect } = await import('react')
  const CheckoutPaymentStub = ({
    onTotalChange,
    onPaymentSuccess,
    onPaymentError,
  }: {
    onTotalChange?: (dollars: number) => void
    onPaymentSuccess?: (sessionId: string) => void | Promise<void>
    onPaymentError?: (message: string) => void
  }) => {
    useEffect(() => {
      if (live.dollars !== null) onTotalChange?.(live.dollars)
    }, [onTotalChange])
    // Mirrors CheckoutForm: every error sets the provider's error and then
    // calls onError; the card is confirmed, then onSuccess runs, and
    // anything it throws reaches the same onError a decline does.
    const fail = (message: string) => {
      providerError.set(message)
      onPaymentError?.(message)
    }
    const complete = async () => {
      try {
        await onPaymentSuccess?.('cs_test')
      } catch (err) {
        fail(err instanceof Error ? err.message : String(err))
      }
    }
    return (
      <div data-testid="checkout-payment">
        <button type="button" onClick={() => fail(DECLINE)}>
          Decline the card
        </button>
        <button type="button" onClick={() => void complete()}>
          Complete purchase
        </button>
      </div>
    )
  }
  return { default: CheckoutPaymentStub }
})

vi.mock(
  'app/dashboard/purchase/components/CheckoutSessionProvider',
  async () => {
    const { useSyncExternalStore } = await import('react')
    return {
      useCheckoutSession: () => ({
        checkoutSession: {
          id: 'cs_test',
          clientSecret: 'secret',
          amount: 1197.42,
        },
        error: useSyncExternalStore(
          providerError.subscribe,
          () => providerError.value,
        ),
        setError: providerError.set,
        fetchClientSecret: vi.fn().mockResolvedValue('secret'),
      }),
    }
  },
)

vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => [{ hasFreeTextsOffer: false }],
}))

const renderStep = (
  overrides: Partial<ComponentProps<typeof SmsReviewStep>> = {},
) =>
  render(
    <SmsReviewStep
      isServe={false}
      name="GOTV blast"
      audienceName="Everybody"
      sendAt={new Date('2026-10-29T13:00:00Z')}
      timeZone="America/New_York"
      composedMessage="Hi {first_name}, vote early."
      imagePreviewUrl={null}
      contactCount={34212}
      pricePerContact={0.035}
      outreachId={83518}
      phoneListToken="tok"
      phoneListBuildId={null}
      excludedOptedOutCount={0}
      excludedDuplicatePhoneCount={0}
      preparing={false}
      prepareError={false}
      onComplete={vi.fn()}
      {...overrides}
    />,
  )

beforeEach(() => {
  live.dollars = null
  providerError.value = null
})

describe('SmsReviewStep totals', () => {
  it('shows the session amount until Stripe has priced the session', async () => {
    renderStep()

    expect(await screen.findByText('$1197.42 due today')).toBeInTheDocument()
    expect(screen.getByText('$1197.42')).toBeInTheDocument()
  })

  it('shows the discounted total in the summary and the due-today note once a promo applies', async () => {
    live.dollars = 847.42

    renderStep()

    expect(await screen.findByText('$847.42 due today')).toBeInTheDocument()
    expect(screen.getByText('$847.42')).toBeInTheDocument()
    expect(screen.queryByText('$1197.42')).not.toBeInTheDocument()
  })
})

describe('SmsReviewStep pay-before-ready ceiling copy', () => {
  it('states the total as a ceiling when the price is an estimate (hold billing)', async () => {
    renderStep({ priceIsCeiling: true })

    expect(await screen.findByText('Up to $1197.42')).toBeInTheDocument()
    expect(
      screen.getByText(/Charged for your reachable list, up to this amount\./),
    ).toBeInTheDocument()
    // Not the flat-charge vocabulary.
    expect(screen.queryByText('$1197.42 due today')).not.toBeInTheDocument()
  })

  it('states a flat due-today charge when the price is exact (default)', async () => {
    renderStep()

    expect(await screen.findByText('$1197.42 due today')).toBeInTheDocument()
    expect(screen.queryByText('Up to $1197.42')).not.toBeInTheDocument()
  })
})

describe('SmsReviewStep card declines', () => {
  it('keeps the payment form and shows the decline reason instead of an initialization error', async () => {
    renderStep()
    await screen.findByTestId('checkout-payment')

    fireEvent.click(screen.getByRole('button', { name: 'Decline the card' }))

    expect(await screen.findByText(DECLINE)).toBeInTheDocument()
    expect(screen.getByTestId('checkout-payment')).toBeInTheDocument()
    expect(
      screen.queryByText('Failed to initialize purchase'),
    ).not.toBeInTheDocument()
    expect(screen.getByText('$1197.42')).toBeInTheDocument()
  })

  it('clears the decline alert once a retry goes through', async () => {
    mswServer.use(
      http.post('/api/v1/payments/purchase/complete-checkout-session', () =>
        HttpResponse.json({}),
      ),
    )
    // The success transition is whatever the flow does after completion; a
    // promise that never settles keeps the step on screen during it.
    renderStep({ onComplete: () => new Promise<void>(() => undefined) })
    await screen.findByTestId('checkout-payment')
    fireEvent.click(screen.getByRole('button', { name: 'Decline the card' }))
    expect(await screen.findByText(DECLINE)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Complete purchase' }))

    await waitFor(() =>
      expect(screen.queryByText(DECLINE)).not.toBeInTheDocument(),
    )
    expect(screen.getByTestId('checkout-payment')).toBeInTheDocument()
  })

  it('shows the purchase error, not the card decline, when completion fails after the charge', async () => {
    mswServer.use(
      http.post('/api/v1/payments/purchase/complete-checkout-session', () =>
        HttpResponse.json(
          { statusCode: 500, message: 'Internal server error' },
          { status: 500 },
        ),
      ),
    )
    renderStep()
    await screen.findByTestId('checkout-payment')

    fireEvent.click(screen.getByRole('button', { name: 'Complete purchase' }))

    expect(
      await screen.findByText('Failed to initialize purchase'),
    ).toBeInTheDocument()
    expect(
      screen.queryByText("Your payment didn't go through"),
    ).not.toBeInTheDocument()
    expect(screen.queryByTestId('checkout-payment')).not.toBeInTheDocument()
  })
})
