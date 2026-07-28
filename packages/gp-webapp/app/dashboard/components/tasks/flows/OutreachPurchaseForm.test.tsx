import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { OutreachPurchaseForm } from './OutreachPurchaseForm'

vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => [{ hasFreeTextsOffer: false }],
}))
vi.mock(
  'app/dashboard/components/tasks/flows/hooks/P2pUxEnabledProvider',
  () => ({
    useP2pUxEnabled: () => ({ p2pUxEnabled: true }),
  }),
)
vi.mock('app/dashboard/purchase/components/CheckoutSessionProvider', () => ({
  useCheckoutSession: () => ({ checkoutSession: { amount: 5000 } }),
}))
vi.mock('app/dashboard/purchase/components/CheckoutPayment', () => ({
  default: () => <div data-testid="checkout-payment" />,
}))

// ENG-10808: the "Review" screen is the first place a text campaign's real
// (post-Peerly-build) contact count renders — the opted-out and duplicate
// exclusion counts belong right alongside it so a user who saw a bigger
// number on the audience step understands the gap.
describe('OutreachPurchaseForm exclusion counts', () => {
  it('shows both exclusion counts when the build excluded contacts', () => {
    render(
      <OutreachPurchaseForm
        contactCount={1500}
        excludedOptedOutCount={12}
        excludedDuplicatePhoneCount={7}
      />,
    )

    expect(screen.getByText('Excluded (opted out)')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('Duplicate numbers removed')).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()
  })

  it('omits both rows when neither count is set', () => {
    render(<OutreachPurchaseForm contactCount={1500} />)

    expect(screen.queryByText('Excluded (opted out)')).not.toBeInTheDocument()
    expect(
      screen.queryByText('Duplicate numbers removed'),
    ).not.toBeInTheDocument()
  })

  it('omits a zero count independently of the other', () => {
    render(
      <OutreachPurchaseForm
        contactCount={1500}
        excludedOptedOutCount={0}
        excludedDuplicatePhoneCount={9}
      />,
    )

    expect(screen.queryByText('Excluded (opted out)')).not.toBeInTheDocument()
    expect(screen.getByText('Duplicate numbers removed')).toBeInTheDocument()
    expect(screen.getByText('9')).toBeInTheDocument()
  })
})
