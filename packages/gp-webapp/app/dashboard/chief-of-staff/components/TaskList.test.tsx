import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import TaskList from './TaskList'
import type { DashboardCard, OnboardingCard } from '../data/contracts'

const cardsRef: {
  current: { data?: DashboardCard[]; isPending: boolean; isError: boolean }
} = { current: { data: [], isPending: false, isError: false } }
const onboardingRef: { current: OnboardingCard[] | undefined } = {
  current: [],
}

vi.mock('../data/use-dashboard', () => ({
  useDashboardCards: () => cardsRef.current,
  useOnboardingCards: () => ({ data: onboardingRef.current }),
  useDismissCard: () => ({ mutate: vi.fn(), isPending: false }),
}))

beforeEach(() => {
  cardsRef.current = { data: [], isPending: false, isError: false }
  onboardingRef.current = []
})

describe('<TaskList>', () => {
  it('names a next step when there is genuinely nothing on the list', () => {
    render(<TaskList />)
    const empty = screen.getByTestId('task-list-empty')
    expect(empty).toHaveTextContent('No tasks this week.')
    // docs/product-copy.md rule 8: what happened, then what to do.
    expect(empty).toHaveTextContent(/ask your chief of staff/i)
  })

  // The dashboard's own copy must not say the thing the agent is forbidden
  // from saying (see the PROACTIVITY block in chiefOfStaffPrompt.ts).
  it('never claims the user is all caught up', () => {
    render(<TaskList />)
    expect(screen.queryByText(/all caught up/i)).not.toBeInTheDocument()
  })

  it('does not explain the system or use an em-dash', () => {
    const { container } = render(<TaskList />)
    expect(container.textContent).not.toMatch(/briefings are ready/i)
    expect(container.textContent).not.toContain('—')
  })

  // The banner sits directly above this list. A briefing generating IS work in
  // progress, so an empty state beside it reads as a contradiction.
  it('stays silent while a briefing is generating', () => {
    const { container } = render(<TaskList briefingInFlight />)
    expect(container).toBeEmptyDOMElement()
  })

  it('stays silent while the onboarding cards are still shown', () => {
    onboardingRef.current = [{ key: 'meet', status: 'active' }]
    const { container } = render(<TaskList />)
    expect(container).toBeEmptyDOMElement()
  })

  it('stays silent until the onboarding cards have loaded', () => {
    onboardingRef.current = undefined
    const { container } = render(<TaskList />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the cards it has', () => {
    cardsRef.current = {
      data: [
        {
          id: 'c1',
          type: 'briefing',
          title: 'Prep for the zoning vote',
          summary: 'Three items worth reading first.',
          ctaLabel: 'Open briefing',
          ctaHref: '/dashboard/briefings',
          dueDate: '2026-09-21T18:00:00.000Z',
          sourceExternalId: 'ext-1',
          sourceItemId: null,
          dismissedAt: null,
          createdAt: '2026-09-14T00:00:00.000Z',
          updatedAt: '2026-09-14T00:00:00.000Z',
        },
      ],
      isPending: false,
      isError: false,
    }
    render(<TaskList />)
    expect(screen.queryByTestId('task-list-empty')).not.toBeInTheDocument()
  })
})
