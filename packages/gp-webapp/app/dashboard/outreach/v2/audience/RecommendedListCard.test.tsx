import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from 'helpers/test-utils/render'
import type { RecommendedList } from '@goodparty_org/contracts'
import { RecommendedListCard } from './RecommendedListCard'

const RECOMMENDATION: RecommendedList = {
  variant: 'persuadeAffinity',
  filter: { independentAffinity: true, voterStatus: ['Super', 'Likely'] },
  count: 19000,
  voteGoalShare: 0.48,
  estimatedCostCents: 66500,
  copy: {
    title: 'Persuadable independents',
    criteriaSummary: 'Moderate to high propensity voters open to independents',
  },
  existingFilterId: null,
}

describe('RecommendedListCard', () => {
  it('renders the title, criteria summary, size, share and cost', () => {
    render(
      <RecommendedListCard
        recommendation={RECOMMENDATION}
        channel="sms"
        onSelect={vi.fn()}
      />,
    )

    expect(screen.getByText('Persuadable independents')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Moderate to high propensity voters open to independents',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText(/19,000 people/)).toBeInTheDocument()
    expect(screen.getByText(/48% of your vote goal/)).toBeInTheDocument()
    expect(screen.getByText(/\$665\.00 to reach them/)).toBeInTheDocument()
  })

  // A list can hold more people than the race needs votes, and a card that
  // silently clamped or dropped that would hide the most reassuring number
  // on the screen.
  it('renders a share above 100% rather than clamping it', () => {
    render(
      <RecommendedListCard
        recommendation={{ ...RECOMMENDATION, voteGoalShare: 3.2 }}
        channel="sms"
        onSelect={vi.fn()}
      />,
    )

    expect(screen.getByText(/320% of your vote goal/)).toBeInTheDocument()
  })

  // Door and supporter lists carry no size floor, so a share this small is
  // a real case rather than a hypothetical one — and "0% of your vote goal"
  // reads as an empty list.
  it('floors a very small share to <1% rather than printing 0%', () => {
    render(
      <RecommendedListCard
        recommendation={{ ...RECOMMENDATION, voteGoalShare: 0.001 }}
        channel="sms"
        onSelect={vi.fn()}
      />,
    )

    expect(screen.getByText(/<1% of your vote goal/)).toBeInTheDocument()
    expect(screen.queryByText(/0% of your vote goal/)).not.toBeInTheDocument()
  })

  // The service omits the key entirely when it cannot resolve the race's
  // vote goal (docs/features/recommended-lists.md) — rendering "undefined%"
  // or "0%" here would misreport a real number.
  it('renders no share line when voteGoalShare is absent', () => {
    render(
      <RecommendedListCard
        recommendation={{ ...RECOMMENDATION, voteGoalShare: undefined }}
        channel="sms"
        onSelect={vi.fn()}
      />,
    )

    expect(screen.queryByText(/vote goal/)).not.toBeInTheDocument()
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument()
  })

  // Phone banking and door knocking are volunteer-run, so gp-api omits the
  // cost rather than sending a zero. A "$0.00 to reach them" line would
  // read as "free" where the truth is "not applicable", so the absence has
  // to render as nothing at all.
  it('renders no cost line when estimatedCostCents is absent', () => {
    render(
      <RecommendedListCard
        recommendation={{ ...RECOMMENDATION, estimatedCostCents: undefined }}
        channel="phoneBanking"
        onSelect={vi.fn()}
      />,
    )

    expect(screen.queryByText(/to reach them/)).not.toBeInTheDocument()
    expect(screen.queryByText(/\$0\.00/)).not.toBeInTheDocument()
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument()
  })

  // Door counts are voters; the built-in door-knocking CRM segment counts
  // households (segmentsToFiltersMap.const.ts), so a door-knocking card reads
  // roughly 2x its Contacts counterpart with nothing to explain the gap.
  it('adds the household-count caveat only for the doorKnocking channel', () => {
    const { rerender } = render(
      <RecommendedListCard
        recommendation={RECOMMENDATION}
        channel="sms"
        onSelect={vi.fn()}
      />,
    )
    expect(screen.queryByText(/not households/)).not.toBeInTheDocument()

    rerender(
      <RecommendedListCard
        recommendation={RECOMMENDATION}
        channel="doorKnocking"
        onSelect={vi.fn()}
      />,
    )
    expect(screen.getByText(/not households/)).toBeInTheDocument()
  })

  it('calls onSelect on click and on Enter/Space', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <RecommendedListCard
        recommendation={RECOMMENDATION}
        channel="sms"
        onSelect={onSelect}
      />,
    )
    const card = screen.getByTestId('recommended-list-card')

    await user.click(card)
    expect(onSelect).toHaveBeenCalledTimes(1)

    card.focus()
    await user.keyboard('{Enter}')
    expect(onSelect).toHaveBeenCalledTimes(2)

    await user.keyboard(' ')
    expect(onSelect).toHaveBeenCalledTimes(3)
  })
})
