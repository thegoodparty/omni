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
  districtShare: 0.48,
  copy: {
    title: 'Persuadable independents',
    criteriaSummary: 'Moderate to high propensity voters open to independents',
  },
  existingFilterId: null,
}

describe('RecommendedListCard', () => {
  it('renders the title, criteria summary, size, and district share', () => {
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
    expect(screen.getByText(/48% of your district/)).toBeInTheDocument()
  })

  // A list that clears the 250-voter floor in a very large district really
  // can round to zero, and "0% of your district" reads as an empty list —
  // the one thing the floor exists to guarantee it is not.
  it('floors a very small share to <1% rather than printing 0%', () => {
    render(
      <RecommendedListCard
        recommendation={{ ...RECOMMENDATION, districtShare: 0.001 }}
        channel="sms"
        onSelect={vi.fn()}
      />,
    )

    expect(screen.getByText(/<1% of your district/)).toBeInTheDocument()
    expect(screen.queryByText(/0% of your district/)).not.toBeInTheDocument()
  })

  // The service omits the key entirely when the district-total query fails
  // (docs/features/recommended-lists.md) — rendering "undefined%" or "0% of
  // your district" here would misreport a real number.
  it('renders no district-share line when districtShare is absent', () => {
    render(
      <RecommendedListCard
        recommendation={{ ...RECOMMENDATION, districtShare: undefined }}
        channel="sms"
        onSelect={vi.fn()}
      />,
    )

    expect(screen.queryByText(/of your district/)).not.toBeInTheDocument()
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
