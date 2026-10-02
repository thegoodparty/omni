import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { render } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import type { RaceTargetMetrics } from 'helpers/types'
import { CountsInfoModal } from './CountsInfoModal'

vi.mock('@shared/ui/ModalOrDrawer', () => ({
  ModalOrDrawer: ({
    open,
    children,
  }: {
    open: boolean
    children: React.ReactNode
  }) => (open ? <div role="dialog">{children}</div> : null),
}))

// The modal reads the org's resolved district before fetching voter stats.
vi.mock('@shared/organization-picker', () => ({
  useOrganization: () => ({
    slug: 'campaign-1',
    positionName: 'Burbank City Council',
    district: { id: 'd1', l2Type: 'City', l2Name: 'Burbank' },
  }),
}))

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

const renderModal = async (raceTargetMetrics: RaceTargetMetrics) => {
  api.mock('GET /v1/contacts/stats', { status: 200, data: statsResponse })
  render(<CountsInfoModal raceTargetMetrics={raceTargetMetrics} />)
  await screen.findByText('68,231')
  const items = screen.getAllByRole('listitem')
  return items[items.length - 1]?.textContent
}

describe('CountsInfoModal', () => {
  it('frames a multi-seat race as a top-N finish', async () => {
    const winLine = await renderModal({
      projectedTurnout: 35914,
      winNumber: 17958,
      voterContactGoal: 89790,
      numberOfSeats: 3,
    })

    expect(
      screen.getByText('This is how many votes you need to win 1 of 3 seats.'),
    ).toBeInTheDocument()
    expect(winLine).toBe(
      'To win 1 of 3 seats, you need 17,958 of those voters on your side. That’s enough to finish in the top 3.',
    )
  })

  it('frames a single-seat race as more than half the votes', async () => {
    const winLine = await renderModal({
      projectedTurnout: 3874,
      winNumber: 1938,
      voterContactGoal: 9690,
      numberOfSeats: 1,
    })

    expect(
      screen.getByText('This is how many votes you need to win the race.'),
    ).toBeInTheDocument()
    expect(winLine).toBe(
      'To win, you need 1,938 of those voters on your side. That’s more than half of the votes cast.',
    )
  })

  it('makes no seat claim when the seat count is unknown', async () => {
    const winLine = await renderModal({
      projectedTurnout: 35914,
      winNumber: 17958,
      voterContactGoal: 89790,
      numberOfSeats: null,
    })

    expect(winLine).toBe(
      'To win, you need 17,958 of those voters on your side.',
    )
  })
})
