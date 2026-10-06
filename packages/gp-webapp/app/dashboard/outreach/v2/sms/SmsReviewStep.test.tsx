import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { SmsReviewStep } from './SmsReviewStep'

// What the mocked Stripe form reports as its live total once mounted; null
// means Stripe has not priced the session yet.
const { live } = vi.hoisted(() => ({
  live: { dollars: null as number | null },
}))

vi.mock('app/dashboard/purchase/components/CheckoutPayment', async () => {
  const { useEffect } = await import('react')
  const CheckoutPaymentStub = ({
    onTotalChange,
  }: {
    onTotalChange?: (dollars: number) => void
  }) => {
    useEffect(() => {
      if (live.dollars !== null) onTotalChange?.(live.dollars)
    }, [onTotalChange])
    return <div data-testid="checkout-payment" />
  }
  return { default: CheckoutPaymentStub }
})

vi.mock('app/dashboard/purchase/components/CheckoutSessionProvider', () => ({
  useCheckoutSession: () => ({
    checkoutSession: { id: 'cs_test', clientSecret: 'secret', amount: 1197.42 },
    error: null,
    fetchClientSecret: vi.fn().mockResolvedValue('secret'),
  }),
}))

vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => [{ hasFreeTextsOffer: false }],
}))

const renderStep = () =>
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
      excludedOptedOutCount={0}
      excludedDuplicatePhoneCount={0}
      preparing={false}
      prepareError={false}
      onComplete={vi.fn()}
    />,
  )

describe('SmsReviewStep totals', () => {
  beforeEach(() => {
    live.dollars = null
  })

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
