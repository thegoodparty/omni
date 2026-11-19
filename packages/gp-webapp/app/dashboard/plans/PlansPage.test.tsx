import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { PLAN_PRICING } from '@goodparty_org/contracts'
import PlansPage from './PlansPage'

const mockPlan = vi.hoisted(() => ({ current: 'free' as string }))

vi.mock('@shared/experiments/FeatureFlagGuard', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}))
vi.mock('../shared/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))
vi.mock('../shared/membership/deriveMembershipState', () => ({
  usePlan: () => ({ plan: mockPlan.current }),
}))

describe('PlansPage', () => {
  beforeEach(() => {
    mockPlan.current = 'free'
  })

  it('shows the three plans with prices and credit from PLAN_PRICING', () => {
    render(<PlansPage highlightTeam={false} />)

    const proCard = screen.getByTestId('plan-card-pro')
    expect(proCard).toHaveTextContent(`$${PLAN_PRICING.proCents / 100}`)
    expect(proCard).toHaveTextContent(
      `$${PLAN_PRICING.includedCreditCents / 100} credit`,
    )
    expect(screen.getByTestId('plan-card-team')).toHaveTextContent(
      `$${PLAN_PRICING.teamCents / 100}`,
    )
    expect(screen.getByTestId('plan-card-free')).toHaveTextContent('$0')
    expect(
      screen.getByRole('columnheader', { name: /Compare plans/ }),
    ).toBeInTheDocument()
  })

  it('lists Logins for your team on Team only', () => {
    render(<PlansPage highlightTeam={false} />)

    expect(
      within(screen.getByTestId('plan-card-team')).getByText(
        'Logins for your team',
      ),
    ).toBeInTheDocument()
    expect(
      within(screen.getByTestId('plan-card-pro')).queryByText(
        'Logins for your team',
      ),
    ).toBeNull()
  })

  it('points the CTAs at the Pro upgrade entry with the chosen plan', () => {
    render(<PlansPage highlightTeam={false} />)

    const pro = screen.getAllByRole('link', {
      name: `Join Pro for $${PLAN_PRICING.proCents / 100}`,
    })
    const team = screen.getAllByRole('link', {
      name: `Join Team for $${PLAN_PRICING.teamCents / 100}`,
    })
    expect(pro[0]).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/dashboard\/pro-upgrade\?.*&plan=pro$/),
    )
    expect(team[0]).toHaveAttribute(
      'href',
      expect.stringMatching(/&plan=team$/),
    )
  })

  it('marks the current plan and disables its CTA', () => {
    mockPlan.current = 'pro'
    render(<PlansPage highlightTeam={false} />)

    expect(screen.getAllByText('Current plan').length).toBeGreaterThan(0)
    expect(
      screen.getAllByRole('link', {
        name: `Join Team for $${(PLAN_PRICING.teamCents - PLAN_PRICING.proCents) / 100}`,
      }).length,
    ).toBeGreaterThan(0)
    expect(
      screen.queryAllByRole('link', {
        name: `Join Team for $${PLAN_PRICING.teamCents / 100}`,
      }),
    ).toHaveLength(0)
    for (const button of screen.getAllByRole('button', {
      name: `Join Pro for $${PLAN_PRICING.proCents / 100}`,
    })) {
      expect(button).toBeDisabled()
    }
    expect(screen.queryAllByRole('link', { name: /Join Pro/ })).toHaveLength(0)
    expect(
      screen.getAllByRole('link', { name: /Join Team/ }).length,
    ).toBeGreaterThan(0)
  })

  it('offers nothing below the current plan', () => {
    mockPlan.current = 'team'
    render(<PlansPage highlightTeam={false} />)

    expect(screen.queryAllByRole('link', { name: /Join/ })).toHaveLength(0)
  })

  it('puts Team first on mobile when highlighted', () => {
    render(<PlansPage highlightTeam />)

    expect(screen.getByTestId('plan-card-team').className).toContain('-order-1')
    expect(screen.getByTestId('plan-card-pro').className).not.toContain(
      '-order-1',
    )
  })
})
