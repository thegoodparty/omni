import { describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
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
  intent: 'persuade',
  filter: { independentAffinity: true },
  count: 19000,
  voteGoalShare: 0.48,
  copy: {
    title: 'Persuadable independents',
    criteriaSummary: 'Moderate to high propensity voters',
  },
  existingFilterId: null,
}

const EXISTING_RECOMMENDATION: RecommendedList = {
  ...RECOMMENDATION,
  variant: 'persuadeUndecided',
  intent: 'persuade',
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
  universeName: 'All voters',
  universeCount: 12_000,
  universeLoading: false,
  onSelectUniverse: vi.fn(async () => 99),
  universePending: false,
  recommendations: [] as RecommendedList[],
  recommendationsLoading: false,
  recommendationsError: false,
  recommendedListsChannel: 'sms' as const,
  onCreateRecommendedList: vi.fn(async () => undefined),
  onRecommendationReused: vi.fn(),
  selectedRecommendation: null,
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

// Every audience picker owes the candidate their whole constituency, the way
// the CRM lists index has always offered it. This step was the one surface
// that did not, which is the deviation these cover.
describe('OutreachAudienceStep — the whole-constituency row', () => {
  const openPicker = async () => {
    await userEvent.click(
      await screen.findByRole('button', { name: /Choose a voter list/i }),
    )
  }

  it('offers the universe with its count', async () => {
    render(<OutreachAudienceStep {...baseProps()} />)
    await openPicker()

    expect(await screen.findByText('All voters')).toBeVisible()
    expect(screen.getByText(/12,000/)).toBeVisible()
  })

  // Nothing is saved until it is picked, so the first pick resolves it to a
  // real list AND selects it through `onSelect` — the same path every other
  // row takes, which is what clears a pressed recommendation and runs each
  // flow's own audience-change side effects.
  it('resolves it on pick and selects it through onSelect', async () => {
    const props = baseProps()
    render(<OutreachAudienceStep {...props} />)
    await openPicker()

    await userEvent.click(await screen.findByText('All voters'))

    expect(props.onSelectUniverse).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(props.onSelect).toHaveBeenCalledWith(99))
  })

  // A failed create must not select a list that does not exist.
  it('selects nothing when resolving it fails', async () => {
    const props = {
      ...baseProps(),
      onSelectUniverse: vi.fn(async () => null),
    }
    render(<OutreachAudienceStep {...props} />)
    await openPicker()

    await userEvent.click(await screen.findByText('All voters'))

    expect(props.onSelectUniverse).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(props.onSelect).not.toHaveBeenCalled())
  })

  // Once resolved it is an ordinary saved list, so picking it again must
  // select that row rather than create a second one.
  it('selects the existing list instead of creating another', async () => {
    const props = baseProps()
    render(
      <OutreachAudienceStep
        {...props}
        lists={[{ id: 77, name: 'All voters' } as never]}
      />,
    )
    await openPicker()

    await userEvent.click(await screen.findByText('All voters'))

    expect(props.onSelect).toHaveBeenCalledWith(77)
    expect(props.onSelectUniverse).not.toHaveBeenCalled()
  })

  // It is rendered as its own row at the top, so leaving it in the ordinary
  // rows too would read as two different audiences.
  it('does not also list it among the saved lists', async () => {
    render(
      <OutreachAudienceStep
        {...baseProps()}
        lists={[
          { id: 77, name: 'All voters' } as never,
          { id: 78, name: 'Ward 3' } as never,
        ]}
      />,
    )
    await openPicker()

    expect(await screen.findByText('Ward 3')).toBeVisible()
    expect(screen.getAllByText('All voters')).toHaveLength(1)
  })
})

describe('OutreachAudienceStep — recommended lists', () => {
  it('shows a recommendation card with its size and vote-goal share', () => {
    render(
      <OutreachAudienceStep
        {...baseProps()}
        recommendations={[RECOMMENDATION]}
      />,
    )

    expect(screen.getByText('Persuadable independents')).toBeInTheDocument()
    expect(screen.getByText(/19,000 people/)).toBeInTheDocument()
    expect(screen.getByText(/48% of your vote goal/)).toBeInTheDocument()
  })

  it('renders the existing-list picker unchanged when there are no recommendations', () => {
    render(<OutreachAudienceStep {...baseProps()} recommendations={[]} />)

    expect(screen.queryByTestId('recommended-list-card')).toBeNull()
    expect(screen.queryByText('Recommended for you')).toBeNull()
    expect(screen.getByText('Choose a voter list')).toBeInTheDocument()
  })

  it('shows the unified landing skeleton while lists/recommendations resolve', () => {
    render(<OutreachAudienceStep {...baseProps()} recommendationsLoading />)

    expect(screen.getByTestId('outreach-audience-loading')).toBeInTheDocument()
    expect(screen.queryByTestId('recommended-list-card')).toBeNull()
  })

  // A warehouse outage (502/504) must not read as "no recommendations" —
  // distinguishable by a dedicated error node, not just an empty list.
  it('shows an error state distinct from the empty state', () => {
    render(<OutreachAudienceStep {...baseProps()} recommendationsError />)

    expect(screen.getByTestId('recommended-lists-error')).toBeInTheDocument()
    expect(screen.queryByTestId('outreach-audience-loading')).toBeNull()
    expect(screen.queryByTestId('recommended-list-card')).toBeNull()
  })

  it('opens the naming drawer for a recommendation with no existingFilterId', async () => {
    const user = userEvent.setup()
    const onCreateRecommendedList = vi.fn(async () => undefined)
    const onSelect = vi.fn()
    render(
      <OutreachAudienceStep
        {...baseProps()}
        recommendations={[RECOMMENDATION]}
        onCreateRecommendedList={onCreateRecommendedList}
        onSelect={onSelect}
      />,
    )

    await user.click(screen.getByTestId('recommended-list-card'))

    // The drawer opens with the recommendation's copy.title pre-filled,
    // and the create callback only fires once the candidate submits — not
    // on the card tap alone.
    expect(
      await screen.findByRole('textbox', { name: 'List name' }),
    ).toHaveValue('Persuadable independents')
    expect(onCreateRecommendedList).not.toHaveBeenCalled()
    expect(onSelect).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(onCreateRecommendedList).toHaveBeenCalledWith(
      RECOMMENDATION,
      'Persuadable independents',
    )
  })

  // existingFilterId exists precisely so accepting the same recommendation
  // twice selects the saved list rather than creating a duplicate.
  it('selects the existing list when the recommendation already exists', async () => {
    const user = userEvent.setup()
    const onCreateRecommendedList = vi.fn(async () => undefined)
    const onRecommendationReused = vi.fn()
    const onSelect = vi.fn()
    render(
      <OutreachAudienceStep
        {...baseProps()}
        recommendations={[EXISTING_RECOMMENDATION]}
        onCreateRecommendedList={onCreateRecommendedList}
        onRecommendationReused={onRecommendationReused}
        onSelect={onSelect}
      />,
    )

    await user.click(screen.getByTestId('recommended-list-card'))

    expect(onSelect).toHaveBeenCalledWith(501)
    expect(onCreateRecommendedList).not.toHaveBeenCalled()
    // This branch never reaches createList, so it is where the accept has
    // to be reported from or reuse goes uncounted.
    expect(onRecommendationReused).toHaveBeenCalledWith(EXISTING_RECOMMENDATION)
  })
})

// A recommendation carried in from the voter data page (`?recommended=`):
// the step applies it on arrival exactly as tapping its card would, and
// keeps the card on screen so the candidate sees what they arrived with.
describe('OutreachAudienceStep — a preselected recommendation', () => {
  // The prototype lands with the list already chosen and nothing asking for
  // a name: the card is the selection, and Continue saves it as it advances.
  it('selects it on arrival for one that is not saved yet, without the naming drawer', async () => {
    const onPreselectedRecommendationApplied = vi.fn()
    const onSelectRecommendation = vi.fn()
    const onCreateRecommendedList = vi.fn(async () => undefined)
    render(
      <OutreachAudienceStep
        {...baseProps()}
        preselectedRecommendation={RECOMMENDATION}
        preselectedRecommendationApplied={false}
        onPreselectedRecommendationApplied={onPreselectedRecommendationApplied}
        onSelectRecommendation={onSelectRecommendation}
        onCreateRecommendedList={onCreateRecommendedList}
      />,
    )

    await waitFor(() =>
      expect(onSelectRecommendation).toHaveBeenCalledWith(RECOMMENDATION),
    )
    expect(screen.queryByRole('textbox', { name: 'List name' })).toBeNull()
    expect(onPreselectedRecommendationApplied).toHaveBeenCalledTimes(1)
    expect(onCreateRecommendedList).not.toHaveBeenCalled()
    // The card stays listed even though this purpose's own recommendations
    // did not include it.
    expect(screen.getByTestId('recommended-list-card')).toHaveTextContent(
      'Persuadable independents',
    )
  })

  it('selects the saved list on arrival for one the candidate already has', async () => {
    const onSelect = vi.fn()
    const onRecommendationReused = vi.fn()
    const onPreselectedRecommendationApplied = vi.fn()
    render(
      <OutreachAudienceStep
        {...baseProps()}
        lists={[{ id: 501, name: 'Undecided persuadables' }]}
        preselectedRecommendation={EXISTING_RECOMMENDATION}
        preselectedRecommendationApplied={false}
        onPreselectedRecommendationApplied={onPreselectedRecommendationApplied}
        onSelect={onSelect}
        onRecommendationReused={onRecommendationReused}
      />,
    )

    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(501))
    expect(onRecommendationReused).toHaveBeenCalledWith(EXISTING_RECOMMENDATION)
    expect(onPreselectedRecommendationApplied).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('textbox', { name: 'List name' })).toBeNull()
  })

  // Spent is the hook's memory, not this step's: the step unmounts between
  // steps, and Back into it must not reopen a drawer the candidate closed.
  it('does nothing on arrival once the preselection has been applied', () => {
    const onPreselectedRecommendationApplied = vi.fn()
    render(
      <OutreachAudienceStep
        {...baseProps()}
        preselectedRecommendation={RECOMMENDATION}
        preselectedRecommendationApplied
        onPreselectedRecommendationApplied={onPreselectedRecommendationApplied}
      />,
    )

    expect(screen.queryByRole('textbox', { name: 'List name' })).toBeNull()
    expect(onPreselectedRecommendationApplied).not.toHaveBeenCalled()
    expect(screen.getByTestId('recommended-list-card')).toBeInTheDocument()
  })

  it('paints the selected recommendation as the pressed card', () => {
    render(
      <OutreachAudienceStep
        {...baseProps()}
        recommendations={[RECOMMENDATION, EXISTING_RECOMMENDATION]}
        selectedRecommendation={RECOMMENDATION}
      />,
    )

    const cards = screen.getAllByTestId('recommended-list-card')
    expect(cards[0]).toHaveAttribute('aria-pressed', 'true')
    expect(cards[1]).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows why a Continue that saves the selected recommendation failed', () => {
    render(
      <OutreachAudienceStep
        {...baseProps()}
        recommendations={[RECOMMENDATION]}
        selectedRecommendation={RECOMMENDATION}
        createRecommendedListError="We couldn't save this list. Try again."
      />,
    )

    expect(
      screen.getByText("We couldn't save this list. Try again."),
    ).toBeInTheDocument()
  })

  it('keeps the carried card on screen when the purpose query fails', () => {
    render(
      <OutreachAudienceStep
        {...baseProps()}
        recommendationsError
        preselectedRecommendation={RECOMMENDATION}
        preselectedRecommendationApplied
      />,
    )

    expect(screen.getByTestId('recommended-lists-error')).toBeInTheDocument()
    expect(screen.getByTestId('recommended-list-card')).toHaveTextContent(
      'Persuadable independents',
    )
  })

  it('does not list the carried card twice when the purpose already offers it', () => {
    render(
      <OutreachAudienceStep
        {...baseProps()}
        recommendations={[RECOMMENDATION]}
        preselectedRecommendation={RECOMMENDATION}
        preselectedRecommendationApplied
      />,
    )

    expect(screen.getAllByTestId('recommended-list-card')).toHaveLength(1)
  })
})
