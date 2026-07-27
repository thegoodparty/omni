import { beforeEach, describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import DistrictStatCard from './DistrictStatCard'

const STATS_RESPONSE = {
  districtId: '1234',
  totalConstituents: 30000,
  totalConstituentsWithCellPhone: 9000,
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

    render(<DistrictStatCard label="Total constituents in your district" />)

    expect(await screen.findByText('30,000')).toBeInTheDocument()
    expect(
      screen.queryByText(/Projected turnout|Voters needed to win/),
    ).not.toBeInTheDocument()
  })
})
