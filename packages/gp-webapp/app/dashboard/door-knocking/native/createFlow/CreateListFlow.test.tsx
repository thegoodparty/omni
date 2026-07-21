import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import CreateListFlow from './CreateListFlow'
import type { PolygonRing } from '../VoterMapCanvas'

// mapbox-gl-draw hands back an open ring; save must close it before POSTing.
const OPEN_RING: PolygonRing = [
  [-87.66, 41.92],
  [-87.65, 41.92],
  [-87.65, 41.93],
]

const baseProps = {
  filters: {},
  onFiltersChange: vi.fn(),
  onStepChange: vi.fn(),
  onClose: vi.fn(),
  matchingHouseholds: 1500,
  ring: OPEN_RING,
  turfStats: { stops: 14, people: 22 },
  onSaved: vi.fn(),
}

describe('CreateListFlow', () => {
  beforeEach(() => {
    testQueryClient.clear()
    vi.clearAllMocks()
  })

  it('creates the voter list from the filter draft, then the turf', async () => {
    const calls: Array<{ kind: string; body: unknown }> = []
    api.mock('POST /v1/voters/voter-file/filter', ({ body }) => {
      calls.push({ kind: 'filter', body })
      return { status: 200, data: { id: 77 } }
    })
    api.mock('POST /v1/door-knocking/turfs', ({ body }) => {
      calls.push({ kind: 'turf', body })
      return {
        status: 200,
        data: {
          id: 5,
          voterFileFilterId: 77,
          name: 'Lakeview blitz',
          color: '#2563eb',
          geoPoly: {
            type: 'Polygon',
            coordinates: [[...OPEN_RING, OPEN_RING[0] as [number, number]]],
          },
          locked: false,
          createdAt: new Date('2026-07-21T00:00:00Z'),
          updatedAt: new Date('2026-07-21T00:00:00Z'),
        },
      }
    })
    const onSaved = vi.fn()

    render(
      <CreateListFlow
        {...baseProps}
        step="confirm"
        filters={{ partyDemocrat: true }}
        onSaved={onSaved}
      />,
    )

    fireEvent.change(screen.getByLabelText('Turf name'), {
      target: { value: 'Lakeview blitz' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save and exit' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(false))
    expect(calls.map((call) => call.kind)).toEqual(['filter', 'turf'])
    expect(calls[0]?.body).toMatchObject({
      name: 'Lakeview blitz',
      partyDemocrat: true,
      partyRepublican: false,
    })
    expect(calls[1]?.body).toMatchObject({
      voterFileFilterId: 77,
      name: 'Lakeview blitz',
      geoPoly: {
        type: 'Polygon',
        coordinates: [
          [
            [-87.66, 41.92],
            [-87.65, 41.92],
            [-87.65, 41.93],
            [-87.66, 41.92],
          ],
        ],
      },
    })
  })

  it('gates the draw step on a drawn shape under the cap', () => {
    const { rerender } = render(
      <CreateListFlow
        {...baseProps}
        step="draw"
        ring={null}
        turfStats={null}
      />,
    )
    expect(
      screen.getByRole('button', { name: /Continue \(0 doors\)/ }),
    ).toBeDisabled()

    rerender(
      <CreateListFlow
        {...baseProps}
        step="draw"
        ring={OPEN_RING}
        turfStats={{ stops: 151, people: 300 }}
      />,
    )
    expect(
      screen.getByRole('button', { name: /Continue \(151 doors\)/ }),
    ).toBeDisabled()
    expect(screen.getByText(/Over the 150-stop limit/)).toBeInTheDocument()

    rerender(
      <CreateListFlow
        {...baseProps}
        step="draw"
        ring={OPEN_RING}
        turfStats={{ stops: 14, people: 22 }}
      />,
    )
    expect(
      screen.getByRole('button', { name: /Continue \(14 doors\)/ }),
    ).toBeEnabled()
  })

  it('advances from filters to draw', () => {
    const onStepChange = vi.fn()
    render(
      <CreateListFlow
        {...baseProps}
        step="filters"
        onStepChange={onStepChange}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(onStepChange).toHaveBeenCalledWith('draw')
  })
})
