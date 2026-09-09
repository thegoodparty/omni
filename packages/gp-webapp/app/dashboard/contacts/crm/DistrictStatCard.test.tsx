import { beforeEach, describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import DistrictStatCard from './DistrictStatCard'

const STATS_RESPONSE = {
  districtId: '1234',
  totalConstituents: 30000,
  totalConstituentsWithCellPhone: 9000,
  districtPopulation: 45000,
  computedAt: new Date().toISOString(),
  buckets: {
    age: [],
    homeowner: [],
    education: [],
    presenceOfChildren: [],
    estimatedIncomeRange: [],
  },
}

beforeEach(() => {
  api.reset()
})

describe('DistrictStatCard', () => {
  it('shows a loading skeleton (not a stale/zero number) before the stats query resolves', () => {
    api.mock('GET /v1/contacts/stats', { status: 200, data: STATS_RESPONSE })

    render(<DistrictStatCard label="Total voters in your district" />)

    expect(
      screen.getByText('Total voters in your district'),
    ).toBeInTheDocument()
    expect(screen.queryByText('30,000')).not.toBeInTheDocument()
    expect(screen.queryByText('Unavailable')).not.toBeInTheDocument()
  })

  it('shows the formatted count once the stats query resolves', async () => {
    api.mock('GET /v1/contacts/stats', { status: 200, data: STATS_RESPONSE })

    render(<DistrictStatCard label="Total voters in your district" />)

    expect(await screen.findByText('30,000')).toBeInTheDocument()
  })

  it('shows "Unavailable" — not a stale skeleton or a silent zero — on a failed fetch', async () => {
    api.mock('GET /v1/contacts/stats', {
      status: 500,
      data: { message: 'server exploded' },
    })

    render(<DistrictStatCard label="Total voters in your district" />)

    expect(await screen.findByText('Unavailable')).toBeInTheDocument()
  })

  it('renders the Win trio: fetched voters row plus formatted metric rows, rounding fractional values', async () => {
    api.mock('GET /v1/contacts/stats', { status: 200, data: STATS_RESPONSE })

    render(
      <DistrictStatCard
        label="Voters in your district"
        additionalRows={[
          { label: 'Projected turnout', value: 42318 },
          // winNumber can be fractional (floor(turnout/2) + 1 vs BR data);
          // display must round to the prototype's whole-number formatting.
          { label: 'Voters needed to win', value: 21159.5 },
        ]}
      />,
    )

    expect(await screen.findByText('30,000')).toBeInTheDocument()
    expect(screen.getByText('Projected turnout')).toBeInTheDocument()
    expect(screen.getByText('42,318')).toBeInTheDocument()
    expect(screen.getByText('Voters needed to win')).toBeInTheDocument()
    expect(screen.getByText('21,160')).toBeInTheDocument()
  })

  it('renders exactly one row when no additional rows are passed (Serve)', async () => {
    api.mock('GET /v1/contacts/stats', { status: 200, data: STATS_RESPONSE })

    render(<DistrictStatCard label="Records available" />)

    expect(await screen.findByText('30,000')).toBeInTheDocument()
    expect(
      screen.queryByText(/Projected turnout|Voters needed to win/),
    ).not.toBeInTheDocument()
  })

  it('renders no census row when no populationLabel is passed (Win)', async () => {
    api.mock('GET /v1/contacts/stats', { status: 200, data: STATS_RESPONSE })

    render(<DistrictStatCard label="Voters in your district" />)

    expect(await screen.findByText('30,000')).toBeInTheDocument()
    expect(
      screen.queryByText('Total constituents in your district'),
    ).not.toBeInTheDocument()
  })

  it('hides the census row when districtPopulation is null (not "Unavailable", not a zero)', async () => {
    api.mock('GET /v1/contacts/stats', {
      status: 200,
      data: { ...STATS_RESPONSE, districtPopulation: null },
    })

    render(
      <DistrictStatCard
        label="Records available"
        populationLabel="Total constituents in your district"
      />,
    )

    expect(await screen.findByText('30,000')).toBeInTheDocument()
    expect(
      screen.queryByText('Total constituents in your district'),
    ).not.toBeInTheDocument()
  })

  it('renders the census row above the records row, in that order, when both are present', async () => {
    api.mock('GET /v1/contacts/stats', { status: 200, data: STATS_RESPONSE })

    render(
      <DistrictStatCard
        label="Records available"
        populationLabel="Total constituents in your district"
      />,
    )

    expect(await screen.findByText('45,000')).toBeInTheDocument()
    expect(screen.getByText('30,000')).toBeInTheDocument()

    const populationRow = screen.getByText(
      'Total constituents in your district',
    )
    const recordsRow = screen.getByText('Records available')
    // A real DOM-order check: asserting call order or index into a queryAll
    // array would still pass if the rows swapped but both still matched.
    // compareDocumentPosition fails if the records row ends up first.
    expect(
      populationRow.compareDocumentPosition(recordsRow) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })
})
