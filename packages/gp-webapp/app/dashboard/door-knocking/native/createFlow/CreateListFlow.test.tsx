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
  drawPointCount: 3,
  onUndoPoint: vi.fn(),
  onClearPoints: vi.fn(),
  onSaved: vi.fn(),
  isElectedOfficial: false,
  unpreviewableKeys: [],
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
    // The cap is on stops (the router's unit), but the button counts doors —
    // 151 stops holding 140 doors is over the cap and says so.
    expect(
      screen.getByRole('button', { name: /Continue \(140 doors\)/ }),
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
      screen.getByRole('button', { name: /Continue \(9 doors\)/ }),
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

    // 61 households inside the ring are 61 doors across 84 stops, holding 168
    // people — every figure in-polygon, none of them the district's 12,000.
    // The counts sit in their own spans, so this matches the paragraph's whole
    // text rather than a single node.
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === 'P' &&
          /61 doors · 84 stops · 168 people/.test(element.textContent ?? ''),
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/12,000/)).toBeNull()
  })

  // The estimate is denominated in doors, not the stops the router plans, so a
  // block of flats reads as the several doors it actually is.
  it('estimates the walk from doors, before the route exists', () => {
    const { rerender } = render(
      <CreateListFlow
        {...baseProps}
        step="draw"
        turfStats={turfStats(90, 70)}
      />,
    )
    // 70 doors at 45 an hour.
    expect(
      screen.getByText(/About 1 hr 33 min of knocking/),
    ).toBeInTheDocument()

    rerender(
      <CreateListFlow
        {...baseProps}
        step="draw"
        turfStats={turfStats(15, 12)}
      />,
    )
    expect(screen.getByText(/About 16 min of knocking/)).toBeInTheDocument()
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
      screen.getByRole('button', { name: /Continue \(80 doors\)/ }),
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
  const fieldLabel = (key: string) =>
    filterSections
      .flatMap((section) => section.fields)
      .find((field) => field.key === key)?.label

  it('offers the contacts-made group to a campaign', () => {
    const contactsMadeLabel = fieldLabel('contacts_made')
    const partyLabel = fieldLabel('political_party')
    expect(contactsMadeLabel).toBeTruthy()
    expect(partyLabel).toBeTruthy()

    render(<CreateListFlow {...baseProps} step="filters" />)

    expect(screen.getByLabelText(contactsMadeLabel as string)).toBeTruthy()
    expect(screen.getByLabelText(partyLabel as string)).toBeTruthy()
  })

  // The pack has no 65+ bucket, so that pill leaves the shaded preview
  // unnarrowed while the saved list still applies it — a candidate drawing
  // against the wider shape has no way to know unless we say so.
  it('discloses filters the map preview cannot narrow by', () => {
    const { rerender } = render(
      <CreateListFlow {...baseProps} step="draw" unpreviewableKeys={[]} />,
    )
    expect(screen.queryByText(/can’t shade by/)).toBeNull()

    rerender(
      <CreateListFlow
        {...baseProps}
        step="draw"
        unpreviewableKeys={['age65Plus']}
      />,
    )
    const label = filterSections
      .flatMap((section) => section.fields)
      .flatMap((field) => field.options)
      .find((option) => option.key === 'age65Plus')?.label
    expect(label).toBeTruthy()
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === 'P' &&
          new RegExp(`can’t shade by ${label}`).test(element.textContent ?? ''),
      ),
    ).toBeInTheDocument()
  })

  // The bare option labels ('0'…'5+') made this read "the map can't shade by
  // 0 yet", which sounds like a bug rather than a filter.
  it('names the prior-contacts group rather than its bucket number', () => {
    render(
      <CreateListFlow
        {...baseProps}
        step="draw"
        unpreviewableKeys={['contactsMade0', 'contactsMade3']}
      />,
    )

    const disclosure = screen.getByText(
      (_, element) =>
        element?.tagName === 'P' &&
        /can’t shade by/.test(element.textContent ?? ''),
    )
    // Named once, however many of its buckets are selected.
    expect(disclosure.textContent).toContain(
      'can’t shade by Prior contacts made yet',
    )
  })

  // The mis-tap fix: a stray vertex was previously only draggable somewhere
  // harmless, and a turf's polygon freezes permanently once it is knocked.
  it('offers Undo only once a point exists, and Clear throughout', () => {
    const onUndoPoint = vi.fn()
    const onClearPoints = vi.fn()
    const { rerender } = render(
      <CreateListFlow
        {...baseProps}
        step="draw"
        ring={null}
        turfStats={null}
        drawPointCount={0}
        onUndoPoint={onUndoPoint}
        onClearPoints={onClearPoints}
      />,
    )
    expect(
      screen.queryByRole('button', { name: 'Undo last boundary point' }),
    ).toBeNull()
    expect(
      screen.getByRole('button', { name: 'Clear the boundary' }),
    ).toBeDisabled()

    rerender(
      <CreateListFlow
        {...baseProps}
        step="draw"
        ring={null}
        turfStats={null}
        drawPointCount={1}
        onUndoPoint={onUndoPoint}
        onClearPoints={onClearPoints}
      />,
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Undo last boundary point' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Clear the boundary' }))
    expect(onUndoPoint).toHaveBeenCalledTimes(1)
    expect(onClearPoints).toHaveBeenCalledTimes(1)
  })

  // The draw chrome is a pointer-events-none overlay so taps reach the map
  // underneath. Only the control cluster re-enables them — miss that and
  // pressing Undo also drops a boundary point where the button was.
  it('keeps the draw controls from leaking a click through to the map', () => {
    render(<CreateListFlow {...baseProps} step="draw" drawPointCount={2} />)

    const undo = screen.getByRole('button', {
      name: 'Undo last boundary point',
    })
    const cluster = undo.parentElement
    expect(cluster).toHaveClass('pointer-events-auto')
    // The row around the cluster stays click-through, so the map keeps the
    // full width of the band it was given.
    expect(cluster?.parentElement).not.toHaveClass('pointer-events-auto')
  })

  // gp-api 400s a contacts-made selection from an elected-office org
  // (assertNoContactsMadeFilterForElectedOffice), so offering it would only
  // ever surface as a failed knock.
  it('hides the contacts-made group from an elected official', () => {
    const contactsMadeLabel = fieldLabel('contacts_made')

    render(<CreateListFlow {...baseProps} step="filters" isElectedOfficial />)

    expect(screen.queryByLabelText(contactsMadeLabel as string)).toBeNull()
  })
})
