import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { PLAN_PRICING, PRICE_PER_TEXT } from '@goodparty_org/contracts'
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
      screen.getByText('Pay once for your plan, good for your whole race.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Upgrade to Team anytime/)).toBeNull()
  })

  it('recommends Pro under Compare plans and captions its column', () => {
    render(<PlansPage highlightTeam={false} />)
    const header = screen.getByRole('columnheader', { name: /Compare plans/ })
    expect(header).toHaveTextContent('We recommend Pro for a race your size.')
    const table = within(screen.getByRole('table'))
    const best = table.getByText('Best for your race')
    expect(best.closest('th')).toHaveTextContent('Join Pro')
    expect(table.getByText('For you and your team')).toBeInTheDocument()
    expect(table.queryByText('For you on your own')).toBeNull()
    expect(screen.getAllByTestId('recommended-panel')).toHaveLength(1)
  })

  it('recommends Team when the race is large', () => {
    mockPlan.recommendTeam = true
    render(<PlansPage highlightTeam={false} />)
    expect(
      screen.getByRole('columnheader', { name: /Compare plans/ }),
    ).toHaveTextContent('We recommend Team for a race your size.')
    const table = within(screen.getByRole('table'))
    expect(
      table.getByText('Best for your race').closest('th'),
    ).toHaveTextContent('Join Team')
    expect(table.getByText('For you on your own')).toBeInTheDocument()
  })

  it('says nothing about a recommendation for a campaign already on a paid plan', () => {
    mockPlan.current = 'pro'
    render(<PlansPage highlightTeam={false} />)
    expect(screen.queryByText(/We recommend/)).toBeNull()
    expect(screen.queryByText('Best for your race')).toBeNull()
  })

  it('lists the rows in the Nov 23 order with the new copy', () => {
    render(<PlansPage highlightTeam={false} />)
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1)
    expect(rows.map((r) => r.querySelector('td')?.textContent)).toEqual([
      'Campaign plan and managerGet a step-by-step plan for your race',
      'Your story and public profileTell voters who you are',
      'Voter data and listsFind voters and build target lists',
      'Voter outreach toolsTexts, robocalls, and more',
      'Campaign verificationGet registered to text voters, a $120 value',
      'Door knocking and phone bankingRoutes and call lists for volunteers',
      'Logins for your teamAdd a campaign manager and volunteers',
    ])
  })

  it('derives the texts the credit buys from the pricing constants', () => {
    render(<PlansPage highlightTeam={false} />)
    const texts = Math.round(
      PLAN_PRICING.includedCreditCents / 100 / PRICE_PER_TEXT,
    )
    expect(texts).toBe(5000)
    const table = within(screen.getByRole('table'))
    expect(table.getAllByText('$175 credit included')).toHaveLength(2)
    expect(table.getAllByText('(worth 5,000 texts)')).toHaveLength(2)
    expect(table.queryByText('Bonus')).toBeNull()
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

  it('tags the credit as a Bonus on the phone cards', () => {
    render(<PlansPage highlightTeam={false} />)
    expect(
      within(screen.getByTestId('plan-card-pro')).getByText('Bonus'),
    ).toBeInTheDocument()
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

  it('lists only the difference on the Team card when Pro leads', () => {
    render(<PlansPage highlightTeam={false} />)
    const team = within(screen.getByTestId('plan-card-team'))
    expect(team.getByText('Everything in Pro, plus')).toBeInTheDocument()
    expect(team.getByText('Logins for your team')).toBeInTheDocument()
    expect(team.queryByText('Voter data and lists')).toBeNull()
    expect(team.getAllByRole('listitem')).toHaveLength(1)
    const pro = within(screen.getByTestId('plan-card-pro'))
    expect(pro.getByText('Campaign plan and manager')).toBeInTheDocument()
    expect(pro.getByText('Voter outreach tools')).toBeInTheDocument()
    expect(pro.queryByText('Logins for your team')).toBeNull()
  })

  it('lists only the difference on the Pro card when Team leads', () => {
    mockPlan.recommendTeam = true
    render(<PlansPage highlightTeam={false} />)
    const pro = within(screen.getByTestId('plan-card-pro'))
    expect(pro.getByText('Everything in Team, except')).toBeInTheDocument()
    expect(pro.getByText('Logins for your team')).toBeInTheDocument()
    expect(pro.getAllByRole('listitem')).toHaveLength(1)
    expect(
      within(screen.getByTestId('plan-card-team')).getAllByRole('listitem'),
    ).toHaveLength(7)
  })

  it('fills the recommended card and keeps its ring', () => {
    render(<PlansPage highlightTeam={false} />)
    const pro = screen.getByTestId('plan-card-pro')
    expect(pro.className).toContain('bg-primary/5')
    expect(pro.parentElement?.className).toContain('ring-primary/30')
    expect(screen.getByTestId('plan-card-team').className).not.toContain(
      'bg-primary/5',
    )
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

  it('marks the current plan as plain text with no button under it', () => {
    mockPlan.current = 'pro'
    render(<PlansPage highlightTeam={false} />)

    const current = screen.getAllByText('Current plan')
    expect(current.length).toBeGreaterThan(0)
    for (const el of current) {
      expect(el).not.toHaveAttribute('data-slot', 'badge')
    }
    expect(screen.queryAllByRole('button', { name: /Join Pro/ })).toHaveLength(
      0,
    )
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
