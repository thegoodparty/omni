import { describe, expect, it, vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

// The other seat variants are covered in winNumberCopy.test.ts; this checks
// the card wires the copy in.
const renderCard = async () => {
  api.mock('GET /v1/contacts/stats', { status: 200, data: statsResponse })
  const campaign = { id: 1, raceTargetMetrics: BURBANK } as unknown as Campaign
  render(
    <PathToVictoryStep campaign={campaign} officeName={OFFICE} skipReveal />,
  )
  // The steps sit in a collapsed "How we got this number" accordion.
  expect(screen.queryByRole('list')).not.toBeInTheDocument()
  await userEvent.click(
    screen.getByRole('button', { name: 'How we got this number' }),
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
})
