import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import type { Campaign, RaceTargetMetrics } from 'helpers/types'
import { PathToVictoryStep } from './PathToVictoryStep'

// The card reads the org's resolved district to decide whether to fetch the
// registered-voter count, and useOrganization throws outside its provider.
vi.mock('@shared/organization-picker', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/organization-picker')>()),
  useOrganization: () => ({
    slug: 'campaign-1',
    positionName: 'Burbank City Council',
    district: { id: 'd1', l2Type: 'City', l2Name: 'Burbank' },
  }),
}))

const OFFICE = 'Burbank City Council'

const statsResponse = {
  districtId: 'd1',
  computedAt: '2026-06-11T00:00:00Z',
  totalConstituents: 68231,
  totalConstituentsWithCellPhone: 40000,
  districtPopulation: null,
  buckets: {
    age: [],
    homeowner: [],
    education: [],
    presenceOfChildren: [],
    estimatedIncomeRange: [],
  },
}

// Burbank City Council, CA fills 3 seats in the 2026 general.
const BURBANK: RaceTargetMetrics = {
  projectedTurnout: 35914,
  winNumber: 17958,
  winNumberLower: 17707,
  winNumberUpper: 19162,
  voterContactGoal: 89790,
  numberOfSeats: 3,
}

const renderCard = async (metrics: Partial<RaceTargetMetrics> = {}) => {
  api.mock('GET /v1/contacts/stats', { status: 200, data: statsResponse })
  const campaign = {
    id: 1,
    raceTargetMetrics: { ...BURBANK, ...metrics },
  } as unknown as Campaign
  render(
    <PathToVictoryStep campaign={campaign} officeName={OFFICE} skipReveal />,
  )
  // The registered-voter row lands once the stats fetch resolves.
  await screen.findByText('68,231')
  return within(screen.getByRole('list')).getAllByRole('listitem')
}

const heroSentence = () => screen.getByText(OFFICE).parentElement?.textContent

describe('PathToVictoryStep', () => {
  it('explains a multi-seat race in 4 steps', async () => {
    const steps = await renderCard()

    expect(heroSentence()).toBe(
      `Projected votes to win 1 of 3 available seats on the ${OFFICE}.`,
    )
    expect(screen.getByText(OFFICE)).toHaveClass('font-semibold')
    expect(screen.getByText('17,707–19,162')).toBeInTheDocument()

    expect(steps).toHaveLength(4)
    expect(steps[2]).toHaveTextContent('Votes projected in your race')
    expect(steps[2]).toHaveTextContent(
      'There are 3 seats available, so each voter can pick up to 3 candidates, casting roughly 71,828 votes between them.',
    )
    expect(steps[3]).toHaveTextContent(
      'Enough to finish in the top 3. Races this size can be won with 25.0% of the votes cast.',
    )
    expect(steps[3]).toHaveTextContent('17,958')
  })

  it('explains a single-seat race in 3 steps', async () => {
    const steps = await renderCard({
      projectedTurnout: 3874,
      winNumber: 1938,
      winNumberLower: null,
      winNumberUpper: null,
      numberOfSeats: 1,
    })

    expect(heroSentence()).toBe(
      `Projected votes to win the race for ${OFFICE}.`,
    )
    expect(steps).toHaveLength(3)
    expect(
      screen.queryByText('Votes projected in your race'),
    ).not.toBeInTheDocument()
    expect(steps[2]).toHaveTextContent(
      'There is 1 seat, so you need more than half of the votes cast.',
    )
  })

  it('makes no seat claim when the seat count is unknown', async () => {
    const steps = await renderCard({ numberOfSeats: null })

    expect(heroSentence()).toBe(
      `Projected votes to win the race for ${OFFICE}.`,
    )
    expect(steps).toHaveLength(3)
    expect(steps[2]).toHaveTextContent(
      'Based on the voters we expect to cast a ballot in your race.',
    )
    // The range is turnout-derived and still shown.
    expect(screen.getByText('17,707–19,162')).toBeInTheDocument()
  })

  it('falls back to 3 steps for an archived civics win number', async () => {
    const steps = await renderCard({
      winNumber: 17000,
      winNumberLower: null,
      winNumberUpper: null,
    })

    expect(heroSentence()).toBe(
      `Projected votes to win the race for ${OFFICE}.`,
    )
    expect(steps).toHaveLength(3)
    expect(steps[2]).toHaveTextContent(
      'Based on the voters we expect to cast a ballot in your race.',
    )
    expect(steps[2]).toHaveTextContent('17,000')
  })
})
