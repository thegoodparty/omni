import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { OutreachCreditBalance } from './OutreachCreditBalance'

const state = vi.hoisted(() => ({
  enabled: false,
  cents: 17500,
  hasFreeTextsOffer: false,
  onSubscription: false,
}))

vi.mock('@shared/experiments/winPerCampaignPricingFlag', () => ({
  useWinPerCampaignPricingFlag: () => ({ ready: true, enabled: state.enabled }),
}))

vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => [{ hasFreeTextsOffer: state.hasFreeTextsOffer }],
}))

vi.mock('app/dashboard/shared/membership/deriveMembershipState', () => ({
  usePlan: () => ({
    creditCents: state.cents,
    onSubscription: state.onSubscription,
  }),
}))

beforeEach(() => {
  state.enabled = true
  state.cents = 17500
  state.hasFreeTextsOffer = false
  state.onSubscription = false
})

describe('OutreachCreditBalance', () => {
  it('shows the balance as plain text, with no texts estimate', () => {
    render(<OutreachCreditBalance />)

    expect(screen.getByTestId('outreach-credit-balance')).toHaveTextContent(
      'Outreach credit $175.00',
    )
    expect(screen.queryByText(/left/)).not.toBeInTheDocument()
    expect(screen.queryByText(/About/)).not.toBeInTheDocument()
  })

  it('shows an empty balance', () => {
    state.cents = 0
    render(<OutreachCreditBalance />)

    expect(screen.getByText('$0.00')).toBeInTheDocument()
  })

  it('shows nothing with the flag off', () => {
    state.enabled = false
    render(<OutreachCreditBalance />)

    expect(screen.queryByText('Outreach credit')).not.toBeInTheDocument()
  })

  it('shows nothing for a monthly subscriber, who has no credit', () => {
    state.cents = 0
    state.onSubscription = true
    render(<OutreachCreditBalance />)

    expect(screen.queryByText('Outreach credit')).not.toBeInTheDocument()
  })

  it('shows nothing for a campaign still on the free-texts offer', () => {
    state.hasFreeTextsOffer = true
    render(<OutreachCreditBalance />)

    expect(screen.queryByText('Outreach credit')).not.toBeInTheDocument()
  })
})
