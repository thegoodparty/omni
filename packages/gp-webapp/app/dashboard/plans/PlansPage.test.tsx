import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { PLAN_PRICING } from '@goodparty_org/contracts'
import PlansPage from './PlansPage'

const mockPlan = vi.hoisted(() => ({
  current: 'free' as string,
  onSubscription: false,
  recommendTeam: false,
}))

vi.mock('@shared/experiments/FeatureFlagGuard', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}))
vi.mock('../shared/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}))
vi.mock('../shared/membership/deriveMembershipState', () => ({
  usePlan: () => ({
    plan: mockPlan.current,
    onSubscription: mockPlan.onSubscription,
    recommendTeam: mockPlan.recommendTeam,
  }),
}))

describe('PlansPage', () => {
  beforeEach(() => {
    mockPlan.current = 'free'
    mockPlan.onSubscription = false
    mockPlan.recommendTeam = false
  })

  const cardOrder = (): string[] =>
    screen.getAllByTestId(/^plan-card-/).map((c) => c.dataset.testid ?? '')

  it('leads with Team on a Free campaign in a large race', () => {
    mockPlan.recommendTeam = true
    render(<PlansPage highlightTeam={false} />)
    expect(cardOrder()).toEqual([
      'plan-card-team',
      'plan-card-pro',
      'plan-card-free',
    ])
  })

  it('leads with Pro, then Team, then Free by default', () => {
    render(<PlansPage highlightTeam={false} />)
    expect(cardOrder()).toEqual([
      'plan-card-pro',
      'plan-card-team',
      'plan-card-free',
    ])
  })

  it('gives the highlighted plan the filled button and the other paid plan the outline', () => {
    const { unmount } = render(<PlansPage highlightTeam={false} />)
    const label = (plan: string, cents: number): string =>
      `Join ${plan} for $${cents / 100}`
    const pro = screen.getAllByRole('link', {
      name: label('Pro', PLAN_PRICING.proCents),
    })[0]
    const team = screen.getAllByRole('link', {
      name: label('Team', PLAN_PRICING.teamCents),
    })[0]
    expect(pro?.className).toContain('bg-primary')
    expect(team?.className).not.toContain('bg-primary')
    unmount()

    render(<PlansPage highlightTeam />)
    const teamLead = screen.getAllByRole('link', {
      name: label('Team', PLAN_PRICING.teamCents),
    })[0]
    expect(teamLead?.className).toContain('bg-primary')
  })

  it('shows the heading and subtitle', () => {
    render(<PlansPage highlightTeam={false} />)
    expect(
      screen.getByRole('heading', { name: 'Unlock voter data and outreach' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Pay once, good for your whole campaign\./),
    ).toBeInTheDocument()
    expect(
      screen.getAllByText(/Upgrade to Team anytime/).length,
    ).toBeGreaterThan(0)
  })

  it('puts each paid price in its button label inside the desktop table', () => {
    render(<PlansPage highlightTeam={false} />)
    const table = within(screen.getByRole('table'))
    expect(
      table.getByRole('link', {
        name: `Join Pro for $${PLAN_PRICING.proCents / 100}`,
      }),
    ).toBeInTheDocument()
    expect(
      table.getByRole('link', {
        name: `Join Team for $${PLAN_PRICING.teamCents / 100}`,
      }),
    ).toBeInTheDocument()
  })

  it('tags the credit as a Bonus', () => {
    render(<PlansPage highlightTeam={false} />)
    expect(screen.getAllByText('Bonus').length).toBeGreaterThan(0)
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

  it('names Team with the TEAM badge on its card', () => {
    render(<PlansPage highlightTeam={false} />)
    expect(
      within(screen.getByTestId('plan-card-team')).getByRole('img', {
        name: 'TEAM',
      }),
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

  it('points the Pro CTA at the Pro upgrade entry with the plan', () => {
    render(<PlansPage highlightTeam={false} />)

    const pro = screen.getAllByRole('link', {
      name: `Join Pro for $${PLAN_PRICING.proCents / 100}`,
    })
    expect(pro[0]).toHaveAttribute(
      'href',
      '/dashboard/pro-upgrade?source=navigation&channel=generic&cta=Join+Pro&plan=pro',
    )
  })

  it('points the Team CTA at the upgrade entry with plan=team for a Free campaign', () => {
    render(<PlansPage highlightTeam={false} />)

    const team = screen.getAllByRole('link', {
      name: `Join Team for $${PLAN_PRICING.teamCents / 100}`,
    })
    expect(team[0]).toHaveAttribute(
      'href',
      '/dashboard/pro-upgrade?source=navigation&channel=generic&cta=Join+Team&plan=team',
    )
  })

  it('prices Team as the difference for a Pro campaign and links to plan=team', () => {
    mockPlan.current = 'pro'
    render(<PlansPage highlightTeam={false} />)

    const team = screen.getAllByRole('link', {
      name: `Join Team for $${(PLAN_PRICING.teamCents - PLAN_PRICING.proCents) / 100}`,
    })
    expect(team[0]).toHaveAttribute(
      'href',
      '/dashboard/pro-upgrade?source=navigation&channel=generic&cta=Join+Team&plan=team',
    )
  })

  it('marks the current plan and disables its CTA', () => {
    mockPlan.current = 'pro'
    render(<PlansPage highlightTeam={false} />)

    expect(screen.getAllByText('Current plan').length).toBeGreaterThan(0)
    for (const button of screen.getAllByRole('button', {
      name: `Join Pro for $${PLAN_PRICING.proCents / 100}`,
    })) {
      expect(button).toBeDisabled()
    }
    expect(screen.queryAllByRole('link', { name: /Join Pro/ })).toHaveLength(0)
  })

  it('offers a monthly subscriber no purchase and says why', () => {
    mockPlan.current = 'pro'
    mockPlan.onSubscription = true
    render(<PlansPage highlightTeam={false} />)

    expect(screen.queryAllByRole('link', { name: /Join/ })).toHaveLength(0)
    for (const button of screen.getAllByRole('button', {
      name: `Join Team for $${PLAN_PRICING.teamCents / 100}`,
    })) {
      expect(button).toBeDisabled()
    }
    expect(
      screen.getByText(
        "You're on Pro at $10 a month. Team isn't available on a monthly plan.",
      ),
    ).toBeInTheDocument()
  })

  it('offers nothing below the current plan', () => {
    mockPlan.current = 'team'
    render(<PlansPage highlightTeam={false} />)

    expect(screen.queryAllByRole('link', { name: /Join/ })).toHaveLength(0)
  })
})
