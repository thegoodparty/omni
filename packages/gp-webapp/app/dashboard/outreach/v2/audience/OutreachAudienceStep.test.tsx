import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import type { RecommendedList } from '@goodparty_org/contracts'
import {
  OutreachAudienceStep,
  type OutreachAudienceCopy,
} from './OutreachAudienceStep'

const COPY: OutreachAudienceCopy = {
  pickerTitle: 'Who do you want to reach?',
  pickerBody: 'Pick a saved voter list.',
  filtersTitle: 'Build a voter list',
  filtersBody: 'Pick filters.',
  nameTitle: 'Name your list',
  nameBody: 'You can rename it any time.',
  reachVerb: 'Message',
  reachNoun: 'voters',
  unitCostLabel: 'Each message costs',
}

const RECOMMENDATION: RecommendedList = {
  variant: 'persuadeAffinity',
  filter: { independentAffinity: true },
  count: 19000,
  districtShare: 0.48,
  copy: {
    title: 'Persuadable independents',
    criteriaSummary: 'Moderate to high propensity voters',
  },
  existingFilterId: null,
}

const EXISTING_RECOMMENDATION: RecommendedList = {
  ...RECOMMENDATION,
  variant: 'persuadeUndecided',
  copy: {
    title: 'Undecided persuadables',
    criteriaSummary: 'Undecided voters',
  },
  existingFilterId: 501,
}

const baseProps = () => ({
  channel: 'text' as const,
  copy: COPY,
  mode: 'picker' as const,
  lists: [],
  listsLoading: false,
  selectedId: null,
  onSelect: vi.fn(),
  onStartBuilder: vi.fn(),
  recommendedListsEnabled: true,
  recommendations: [] as RecommendedList[],
  recommendationsLoading: false,
  recommendationsError: false,
  recommendedListsChannel: 'sms' as const,
  onSelectRecommendation: vi.fn(),
  reachableCount: null,
  reachableLoading: false,
  pricePerContact: 0.035,
  builderFilters: {},
  onBuilderFiltersChange: vi.fn(),
  builderSupportStatus: [],
  builderPrecincts: [],
  onBuilderPrecinctsChange: vi.fn(),
  precinctOptions: {
    options: [],
    truncated: false,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
  onBuilderSupportStatusChange: vi.fn(),
  builderName: '',
  onBuilderNameChange: vi.fn(),
  isElectedOfficial: false,
  builderCount: undefined,
  builderCounting: false,
  builderCapError: false,
  builderCountErrorMessage: undefined,
})

describe('OutreachAudienceStep — recommended lists', () => {
  it('shows a recommendation card with its size and district share', () => {
    render(
      <OutreachAudienceStep
        {...baseProps()}
        recommendations={[RECOMMENDATION]}
      />,
    )

    expect(screen.getByText('Persuadable independents')).toBeInTheDocument()
    expect(screen.getByText(/19,000 people/)).toBeInTheDocument()
    expect(screen.getByText(/48% of your district/)).toBeInTheDocument()
  })

  it('shows nothing extra when the flag is off', () => {
    render(
      <OutreachAudienceStep
        {...baseProps()}
        recommendedListsEnabled={false}
        recommendations={[RECOMMENDATION]}
      />,
    )

    expect(screen.queryByTestId('recommended-list-card')).toBeNull()
    expect(screen.queryByText('Recommended for you')).toBeNull()
  })

  it('renders the existing-list picker unchanged when there are no recommendations', () => {
    render(<OutreachAudienceStep {...baseProps()} recommendations={[]} />)

    expect(screen.queryByTestId('recommended-list-card')).toBeNull()
    expect(screen.queryByText('Recommended for you')).toBeNull()
    expect(screen.getByText('Choose a voter list')).toBeInTheDocument()
  })

  it('shows a loading state while counts resolve', () => {
    render(<OutreachAudienceStep {...baseProps()} recommendationsLoading />)

    expect(screen.getByTestId('recommended-lists-loading')).toBeInTheDocument()
    expect(screen.queryByTestId('recommended-list-card')).toBeNull()
  })

  // A warehouse outage (502/504) must not read as "no recommendations" —
  // distinguishable by a dedicated error node, not just an empty list.
  it('shows an error state distinct from the empty state', () => {
    render(<OutreachAudienceStep {...baseProps()} recommendationsError />)

    expect(screen.getByTestId('recommended-lists-error')).toBeInTheDocument()
    expect(screen.queryByTestId('recommended-lists-loading')).toBeNull()
    expect(screen.queryByTestId('recommended-list-card')).toBeNull()
  })

  it('calls onSelectRecommendation for a recommendation with no existingFilterId', async () => {
    const user = userEvent.setup()
    const onSelectRecommendation = vi.fn()
    const onSelect = vi.fn()
    render(
      <OutreachAudienceStep
        {...baseProps()}
        recommendations={[RECOMMENDATION]}
        onSelectRecommendation={onSelectRecommendation}
        onSelect={onSelect}
      />,
    )

    await user.click(screen.getByTestId('recommended-list-card'))

    expect(onSelectRecommendation).toHaveBeenCalledWith(RECOMMENDATION)
    expect(onSelect).not.toHaveBeenCalled()
  })

  // existingFilterId exists precisely so accepting the same recommendation
  // twice selects the saved list rather than creating a duplicate.
  it('selects the existing list when the recommendation already exists', async () => {
    const user = userEvent.setup()
    const onSelectRecommendation = vi.fn()
    const onSelect = vi.fn()
    render(
      <OutreachAudienceStep
        {...baseProps()}
        recommendations={[EXISTING_RECOMMENDATION]}
        onSelectRecommendation={onSelectRecommendation}
        onSelect={onSelect}
      />,
    )

    await user.click(screen.getByTestId('recommended-list-card'))

    expect(onSelect).toHaveBeenCalledWith(501)
    expect(onSelectRecommendation).not.toHaveBeenCalled()
  })
})
