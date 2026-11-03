import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import { router } from 'helpers/test-utils/router-mocking'
import { render } from 'helpers/test-utils/render'
import LossPage from './page'

type MockCampaign = {
  id: number
  isPro?: boolean
  details?: { subscriptionId?: string }
} | null

const { mockCampaign } = vi.hoisted(() => ({
  mockCampaign: { current: null as MockCampaign },
}))

vi.mock('@shared/hooks/useCampaign', () => ({
  useCampaign: () => [mockCampaign.current],
}))

vi.mock('@shared/hooks/useUser', () => ({
  useUser: () => [{ firstName: 'Sarah' }],
}))

vi.mock('gpApi/clientFetch', () => ({
  clientFetch: vi.fn(),
}))

vi.mock('helpers/analyticsHelper', () => ({
  EVENTS: {
    Settings: { Account: { ClickManageSubscription: 'manage_subscription' } },
  },
  trackEvent: vi.fn(),
}))

vi.mock('helpers/useSnackbar', () => ({
  useSnackbar: () => ({ errorSnackbar: vi.fn() }),
}))

describe('LossPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCampaign.current = null
  })

  it('surfaces the billing portal for a Pro campaign with an active subscription', () => {
    mockCampaign.current = {
      id: 1,
      isPro: true,
      details: { subscriptionId: 'sub_123' },
    }

    render(<LossPage />)

    expect(
      screen.getByText(/Pro subscription is still active/i),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Manage subscription' }),
    ).toBeInTheDocument()
  })

  it('shows no subscription alert for a non-Pro campaign', () => {
    mockCampaign.current = { id: 1, isPro: false, details: {} }

    render(<LossPage />)

    expect(
      screen.getByRole('heading', { name: 'Thank you for running, Sarah' }),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Pro subscription is still active/i)).toBeNull()
  })

  it('has the GoodParty logo header with no close button', () => {
    mockCampaign.current = { id: 1, isPro: false, details: {} }

    render(<LossPage />)

    const header = screen.getByRole('banner')
    expect(
      header.querySelector('[data-slot="good-party-org-logo-wordmark"]'),
    ).not.toBeNull()
    expect(within(header).queryByRole('button')).toBeNull()
  })

  it('asks for survey feedback and goes back to the dashboard', () => {
    mockCampaign.current = { id: 1, isPro: false, details: {} }

    render(<LossPage />)

    expect(
      screen.getByText(
        'Putting your name on the ballot takes courage, and you did it. Great work.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'We need your feedback' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'We’re asking everyone who ran with GoodParty.org this year what worked, what didn’t, and how we can support you better next cycle.',
      ),
    ).toBeInTheDocument()
    const survey = screen.getByRole('link', {
      name: /Take the 5-minute survey/,
    })
    expect(survey).toHaveAttribute(
      'href',
      'https://survey.hsforms.com/22zYI2zHtQ6erJaSewyxf-Acuqn1',
    )
    expect(survey).toHaveAttribute('target', '_blank')
    expect(survey).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.queryByRole('link', { name: /community/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Back to dashboard' }))
    expect(router.replace).toHaveBeenCalledWith('/dashboard')
  })
})
