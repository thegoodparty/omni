import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { WhoStep } from './WhoStep'

// Component-level coverage of the recommendations block specifically —
// CreateListFlow.recommendedLists.test.tsx covers the same feature end to
// end, but its "flag off" case can't isolate this component's own
// `recommendedListsEnabled` gate from the query-level gate that also stops
// data from ever arriving when the flag is off. Rendering WhoStep directly
// with recommendations already present is what actually exercises this
// component's guard.
const RECOMMENDATION = {
  variant: 'introNeverIded' as const,
  filter: { voterStatus: ['Super'], precincts: ['Cook|101'] },
  count: 4200,
  voteGoalShare: 0.28,
  copy: {
    title: 'Voters you have not met',
    criteriaSummary: 'Never contacted',
  },
  existingFilterId: null,
}

const baseProps = {
  filters: {},
  onFiltersChange: vi.fn(),
  savedLists: [],
  allContactsHouseholds: 1000,
  selectedListId: null,
  onSelectList: vi.fn(),
  hasPickedAudience: false,
  hasActiveRecommendation: false,
  isServeOrg: false,
  building: false,
  onBuildingChange: vi.fn(),
  open: false,
  onOpenChange: vi.fn(),
  recommendedListsEnabled: true,
  recommendations: [],
  recommendationsLoading: false,
  recommendationsError: false,
  onSelectRecommendation: vi.fn(),
}

describe('WhoStep — recommended lists', () => {
  it('renders nothing when the flag is off, even with recommendations available', () => {
    render(
      <WhoStep
        {...baseProps}
        recommendedListsEnabled={false}
        recommendations={[RECOMMENDATION]}
      />,
    )

    expect(screen.queryByTestId('recommended-list-card')).toBeNull()
    expect(screen.queryByText('Recommended for you')).toBeNull()
  })

  it('renders nothing extra when there are no recommendations', () => {
    render(<WhoStep {...baseProps} recommendations={[]} />)

    expect(screen.queryByTestId('recommended-list-card')).toBeNull()
    expect(screen.queryByText('Recommended for you')).toBeNull()
  })

  // Unified landing loader (matches OutreachAudienceStep): while the recs
  // query is in flight the whole step renders one skeleton block that
  // covers both sections. They reveal together.
  it('shows a single skeleton while recs or the pack resolve', () => {
    render(<WhoStep {...baseProps} recommendationsLoading />)

    expect(screen.getByTestId('who-step-loading')).toBeInTheDocument()
    expect(screen.queryByText('Recommended for you')).toBeNull()
    expect(screen.queryByTestId('recommended-list-card')).toBeNull()
    expect(screen.queryByRole('combobox', { name: 'All lists' })).toBeNull()
  })

  // A 502/504 from the endpoint is deliberate — the service refuses rather
  // than emptying when the warehouse is down — so it must not render as the
  // empty state, which says the candidate has no recommendations.
  it('shows an error state distinct from the empty state', () => {
    render(<WhoStep {...baseProps} recommendationsError />)

    expect(screen.getByTestId('recommended-lists-error')).toBeInTheDocument()
    expect(screen.queryByTestId('who-step-loading')).toBeNull()
    expect(screen.queryByTestId('recommended-list-card')).toBeNull()
    expect(
      screen.getByRole('combobox', { name: 'All lists' }),
    ).toBeInTheDocument()
  })

  it('renders a card per recommendation and selects on click', () => {
    const onSelectRecommendation = vi.fn()
    render(
      <WhoStep
        {...baseProps}
        recommendations={[RECOMMENDATION]}
        onSelectRecommendation={onSelectRecommendation}
      />,
    )

    expect(screen.getByText('Voters you have not met')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('recommended-list-card'))
    expect(onSelectRecommendation).toHaveBeenCalledWith(RECOMMENDATION)
  })

  it('hides recommendations behind "Create a new list"', () => {
    render(
      <WhoStep {...baseProps} recommendations={[RECOMMENDATION]} building />,
    )

    expect(screen.queryByTestId('recommended-list-card')).toBeNull()
    expect(screen.queryByText('Recommended for you')).toBeNull()
  })
})
