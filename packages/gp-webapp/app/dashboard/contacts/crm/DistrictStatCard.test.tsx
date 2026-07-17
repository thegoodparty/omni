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
})
