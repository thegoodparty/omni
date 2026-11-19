import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { OutreachCreditBalance } from './OutreachCreditBalance'

const state = vi.hoisted(() => ({
  enabled: false,
  cents: 17500,
  hasFreeTextsOffer: false,
}))

vi.mock('@shared/experiments/winPerCampaignPricingFlag', () => ({
  useWinPerCampaignPricingFlag: () => ({ ready: true, enabled: state.enabled }),
}))

vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => [{ hasFreeTextsOffer: state.hasFreeTextsOffer }],
}))

vi.mock('app/dashboard/shared/membership/deriveMembershipState', () => ({
  usePlan: () => ({ creditCents: state.cents }),
}))

beforeEach(() => {
  state.enabled = true
  state.cents = 17500
  state.hasFreeTextsOffer = false
})

describe('OutreachCreditBalance', () => {
  it('shows the balance and what it buys in texts', () => {
    render(<OutreachCreditBalance />)

    expect(screen.getByText('$175.00 left')).toBeInTheDocument()
    expect(
      screen.getByText('About 5,000 texts at 3.5¢ each.'),
    ).toBeInTheDocument()
  })

  it('shows an empty balance without the texts line', () => {
    state.cents = 0
    render(<OutreachCreditBalance />)

    expect(screen.getByText('$0.00 left')).toBeInTheDocument()
    expect(screen.queryByText(/About/)).not.toBeInTheDocument()
  })

  it('shows nothing with the flag off', () => {
    state.enabled = false
    render(<OutreachCreditBalance />)

    expect(screen.queryByText('Outreach credit')).not.toBeInTheDocument()
  })

  it('shows nothing for a campaign still on the free-texts offer', () => {
    state.hasFreeTextsOffer = true
    render(<OutreachCreditBalance />)

    expect(screen.queryByText('Outreach credit')).not.toBeInTheDocument()
  })
})
