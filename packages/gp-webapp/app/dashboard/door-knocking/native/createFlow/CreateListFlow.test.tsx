import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import filterSections from 'app/dashboard/contacts/[[...attr]]/components/configs/filters.config'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import CreateListFlow from './CreateListFlow'
import type { PolygonRing } from '../VoterMapCanvas'

vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

// mapbox-gl-draw hands back an open ring; save must close it before POSTing.
const OPEN_RING: PolygonRing = [
  [-87.66, 41.92],
  [-87.65, 41.92],
  [-87.65, 41.93],
]

const turfStats = (stops: number, households: number) => ({
  stops,
  people: stops * 2,
  households,
  partyMix: [],
})

const baseProps = {
  filters: {},
  onFiltersChange: vi.fn(),
  onStepChange: vi.fn(),
  onClose: vi.fn(),
  districtHouseholds: 1500,
  ring: OPEN_RING,
  turfStats: { stops: 14, people: 22, households: 9, partyMix: [] },
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

    fireEvent.change(screen.getByLabelText('Route name'), {
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
    // The list is only created once BOTH writes land, so the event belongs to
    // the turf POST rather than the filter POST that precedes it.
    expect(trackEvent).toHaveBeenCalledWith(EVENTS.DoorKnocking.ListCreated, {
      stops: 14,
      people: 22,
      filterCount: 1,
      drawAnother: false,
    })
  })

  it('reuses the created filter when the turf save is retried', async () => {
    let filterPosts = 0
    let turfPosts = 0
    api.mock('POST /v1/voters/voter-file/filter', () => {
      filterPosts += 1
      return { status: 200, data: { id: 88 } }
    })
    api.mock('POST /v1/door-knocking/turfs', ({ body }) => {
      turfPosts += 1
      if (turfPosts === 1) return { status: 500, data: {} }
      expect(body).toMatchObject({ voterFileFilterId: 88 })
      return {
        status: 200,
        data: {
          id: 6,
          voterFileFilterId: 88,
          name: 'Retry turf',
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

    render(<CreateListFlow {...baseProps} step="confirm" onSaved={onSaved} />)

    fireEvent.change(screen.getByLabelText('Route name'), {
      target: { value: 'Retry turf' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save and exit' }))
    await waitFor(() =>
      expect(screen.getByText(/Saving failed/)).toBeInTheDocument(),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Save and exit' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(false))
    // One list total across both attempts — no orphan per retry.
    expect(filterPosts).toBe(1)
    expect(turfPosts).toBe(2)
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
        turfStats={turfStats(151, 140)}
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
        turfStats={turfStats(14, 9)}
      />,
    )
    expect(
      screen.getByRole('button', { name: /Continue \(14 doors\)/ }),
    ).toBeEnabled()
  })

  // The regression this footer shipped with: households came from a
  // district-wide pass while the door count beside it was in-polygon, so the
  // two numbers at the moment of commitment described different areas.
  it('reports in-polygon households on the draw step, not the district total', () => {
    render(
      <CreateListFlow
        {...baseProps}
        step="draw"
        districtHouseholds={12000}
        turfStats={turfStats(84, 61)}
      />,
    )

    expect(screen.getByText(/61/)).toBeInTheDocument()
    expect(screen.queryByText(/12,000/)).toBeNull()
  })

  it('estimates the walk before the route exists', () => {
    const { rerender } = render(
      <CreateListFlow
        {...baseProps}
        step="draw"
        turfStats={turfStats(90, 70)}
      />,
    )
    // 90 doors at 45 an hour.
    expect(screen.getByText(/About 2 hr 0 min of knocking/)).toBeInTheDocument()

    rerender(
      <CreateListFlow
        {...baseProps}
        step="draw"
        turfStats={turfStats(15, 12)}
      />,
    )
    expect(screen.getByText(/About 20 min of knocking/)).toBeInTheDocument()
  })

  // Soft warning informs; only the 150 cap blocks.
  it('warns past 100 stops without blocking the save', () => {
    const { rerender } = render(
      <CreateListFlow
        {...baseProps}
        step="draw"
        turfStats={turfStats(100, 80)}
      />,
    )
    expect(screen.queryByText(/long evening/)).toBeNull()

    rerender(
      <CreateListFlow
        {...baseProps}
        step="draw"
        turfStats={turfStats(101, 80)}
      />,
    )
    expect(
      screen.getByText(/Over 100 stops is a long evening/),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Continue \(101 doors\)/ }),
    ).toBeEnabled()

    // Past the hard cap only the blocking message stands.
    rerender(
      <CreateListFlow
        {...baseProps}
        step="draw"
        turfStats={turfStats(151, 120)}
      />,
    )
    expect(screen.queryByText(/long evening/)).toBeNull()
    expect(screen.getByText(/Over the 150-stop limit/)).toBeInTheDocument()
  })

  it('breaks the drawn turf down by party', () => {
    render(
      <CreateListFlow
        {...baseProps}
        step="draw"
        turfStats={{
          stops: 40,
          people: 90,
          households: 38,
          partyMix: [
            { label: 'Democratic', people: 50 },
            { label: 'Republican', people: 30 },
            { label: 'Unknown', people: 10 },
          ],
        }}
      />,
    )

    expect(
      screen.getByText('50 Democratic · 30 Republican · 10 Unknown'),
    ).toBeInTheDocument()
  })

  it('resets the filter draft, and offers nothing to reset when it is empty', () => {
    const onFiltersChange = vi.fn()
    const { rerender } = render(
      <CreateListFlow
        {...baseProps}
        step="filters"
        onFiltersChange={onFiltersChange}
      />,
    )
    expect(screen.getByRole('button', { name: 'Reset filters' })).toBeDisabled()

    rerender(
      <CreateListFlow
        {...baseProps}
        step="filters"
        filters={{ partyDemocrat: true }}
        onFiltersChange={onFiltersChange}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }))
    expect(onFiltersChange).toHaveBeenCalledWith({})
  })

  // Before a polygon exists there is nothing to narrow to, so district-wide is
  // the honest number — and the label has to say which one it is.
  it('labels the filters-step count as district-wide', () => {
    render(
      <CreateListFlow
        {...baseProps}
        step="filters"
        districtHouseholds={12000}
      />,
    )

    expect(
      screen.getByText(/matching households in your district/),
    ).toBeInTheDocument()
    expect(screen.getByText('12,000')).toBeInTheDocument()
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

  // Labels are sourced from the config, not hardcoded: 'Contacts Made' was
  // renamed to 'Prior Contacts Made' days after this test landed, which would
  // have made a literal assertion pass while the group still rendered.
  it('omits the contacts-made group, which evaluate would ignore', () => {
    const fieldLabel = (key: string) =>
      filterSections
        .flatMap((section) => section.fields)
        .find((field) => field.key === key)?.label

    const contactsMadeLabel = fieldLabel('contacts_made')
    const partyLabel = fieldLabel('political_party')
    expect(contactsMadeLabel).toBeTruthy()
    expect(partyLabel).toBeTruthy()

    render(<CreateListFlow {...baseProps} step="filters" />)

    expect(screen.queryByLabelText(contactsMadeLabel as string)).toBeNull()
    expect(screen.getByLabelText(partyLabel as string)).toBeTruthy()
  })
})
