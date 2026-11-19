import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
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

  it('shows three plans with prices from PLAN_PRICING', () => {
    render(<PlansPage highlightTeam={false} />)

    expect(screen.getByTestId('plan-card-free')).toHaveTextContent('$0')
    expect(screen.getByTestId('plan-card-pro')).toHaveTextContent(
      `$${PLAN_PRICING.proCents / 100}`,
    )
    expect(screen.getByTestId('plan-card-team')).toHaveTextContent(
      `$${PLAN_PRICING.teamCents / 100}`,
    )
  })

  it('points the CTAs at the Pro upgrade entry with the chosen plan', () => {
    render(<PlansPage highlightTeam={false} />)

    expect(screen.getByRole('link', { name: 'Join Pro' })).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/dashboard\/pro-upgrade\?.*&plan=pro$/),
    )
    expect(screen.getByRole('link', { name: 'Join Team' })).toHaveAttribute(
      'href',
      expect.stringMatching(/&plan=team$/),
    )
  })

  it('marks the current plan and disables its CTA', () => {
    mockPlan.current = 'pro'
    render(<PlansPage highlightTeam={false} />)

    const pro = screen.getByTestId('plan-card-pro')
    expect(pro).toHaveTextContent('Current plan')
    expect(
      screen.getByRole('button', { name: 'Your current plan' }),
    ).toBeDisabled()
    expect(screen.queryByRole('link', { name: 'Join Pro' })).toBeNull()
    expect(
      screen.getByRole('link', { name: 'Upgrade to Team' }),
    ).toBeInTheDocument()
  })

  it('offers nothing below the current plan', () => {
    mockPlan.current = 'team'
    render(<PlansPage highlightTeam={false} />)

    expect(
      screen.queryAllByRole('link', { name: /Join|Upgrade/ }),
    ).toHaveLength(0)
  })

  it('puts Team first on mobile when highlighted', () => {
    render(<PlansPage highlightTeam />)

    expect(screen.getByTestId('plan-card-team').className).toContain('-order-1')
    expect(screen.getByTestId('plan-card-pro').className).not.toContain(
      '-order-1',
    )
  })
})
