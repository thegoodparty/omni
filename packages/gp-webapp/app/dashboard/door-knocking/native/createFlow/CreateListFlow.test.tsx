import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
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
  ageMix: [],
})

const baseProps = {
  filters: {},
  onFiltersChange: vi.fn(),
  onStepChange: vi.fn(),
  onClose: vi.fn(),
  districtHouseholds: 1500,
  savedLists: [],
  allContactsHouseholds: 12000,
  ring: OPEN_RING,
  turfStats: {
    stops: 14,
    people: 22,
    households: 9,
    partyMix: [],
    ageMix: [],
  },
  drawPointCount: 3,
  onUndoPoint: vi.fn(),
  onClearPoints: vi.fn(),
  onSaved: vi.fn(),
  isElectedOfficial: false,
  unpreviewableKeys: [],
  addressPreview: null,
  previewPending: false,
  previewFailed: false,
  previewStale: false,
  onShowAddresses: vi.fn(),
  onHideAddresses: vi.fn(),
  onRetryAddresses: vi.fn(),
}

const preview = (
  locations: Array<{ doors: Array<{ address: string; people: number }> }>,
  totals?: { stops: number; doors: number; people: number },
) => ({
  locations,
  stops: totals?.stops ?? locations.length,
  doors:
    totals?.doors ??
    locations.reduce((sum, location) => sum + location.doors.length, 0),
  people:
    totals?.people ??
    locations.reduce(
      (sum, location) =>
        sum + location.doors.reduce((doors, door) => doors + door.people, 0),
      0,
    ),
})

// The flow opens on the goal cards, and all three pre-draw stages live inside
// the orchestrator's single `filters` step — so a test about the filters walks
// through a goal card to reach them, exactly as a candidate does.
const renderAtWho = (
  props: Partial<ComponentProps<typeof CreateListFlow>> = {},
) => {
  const view = render(
    <CreateListFlow {...baseProps} step="filters" {...props} />,
  )
  fireEvent.click(screen.getByRole('button', { name: /Introduce myself/ }))
  return view
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
          doorCount: null,
          peopleCount: null,
          loggedCount: null,
          completedAt: null,
          archivedAt: null,
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
          doorCount: null,
          peopleCount: null,
          loggedCount: null,
          completedAt: null,
          archivedAt: null,
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
        drawPointCount={0}
      />,
    )
    expect(
      screen.getByRole('button', { name: /Tap 3 points to continue/ }),
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

  // The canvas has no Done: it closes the shape itself and only reports a ring
  // from three points. A tester who placed two and went looking for a confirm
  // button found a dead Continue and nothing on screen naming the rule.
  it('says how many more points the disabled Continue is waiting for', () => {
    const drawing = (drawPointCount: number) => (
      <CreateListFlow
        {...baseProps}
        step="draw"
        ring={null}
        turfStats={null}
        drawPointCount={drawPointCount}
      />
    )
    const { rerender } = render(drawing(1))
    expect(
      screen.getByRole('button', { name: '2 more points to continue' }),
    ).toBeDisabled()

    rerender(drawing(2))
    expect(
      screen.getByRole('button', { name: '1 more point to continue' }),
    ).toBeDisabled()

    // Third point placed: the shape exists, so the same button turns into the
    // finish gesture rather than staying dead with no explanation.
    rerender(
      <CreateListFlow
        {...baseProps}
        step="draw"
        ring={OPEN_RING}
        turfStats={turfStats(14, 9)}
        drawPointCount={3}
      />,
    )
    expect(
      screen.getByRole('button', { name: /Continue \(9 doors\)/ }),
    ).toBeEnabled()
  })

  // The other way to a disabled Continue with three points down: a shape drawn
  // somewhere with nothing in it.
  it('says when the drawn shape holds no doors', () => {
    render(
      <CreateListFlow
        {...baseProps}
        step="draw"
        ring={OPEN_RING}
        turfStats={turfStats(0, 0)}
      />,
    )

    expect(
      screen.getByRole('button', { name: 'No doors in this area' }),
    ).toBeDisabled()
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
          ageMix: [],
        }}
      />,
    )

    expect(
      screen.getByText('50 Democratic · 30 Republican · 10 Unknown'),
    ).toBeInTheDocument()
  })

  it('resets the filter draft, and offers nothing to reset when it is empty', () => {
    const onFiltersChange = vi.fn()
    const { rerender } = renderAtWho({ onFiltersChange })
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

  // CHANGED DELIBERATELY (Voter Outreach 2.0): the count moved off its own
  // line and into the CTA, which is where the canvas puts it. The two-
  // denominator rule is unaffected and still has to be visible — before a
  // polygon exists, district-wide is the only honest denominator — so the line
  // that used to carry both the number and the qualifier now carries the
  // qualifier alone, and the number is in the button.
  it('puts the matching count in the Continue button, and still says it is district-wide', () => {
    renderAtWho({ districtHouseholds: 12000 })

    expect(
      screen.getByRole('button', { name: 'Continue (12,000 households)' }),
    ).toBeEnabled()
    expect(screen.getByText(/Across your whole district/)).toBeInTheDocument()
  })

  it('refuses to continue from an audience holding nobody', () => {
    renderAtWho({ districtHouseholds: 0 })

    expect(
      screen.getByRole('button', { name: 'No matching households' }),
    ).toBeDisabled()
  })

  // CHANGED DELIBERATELY: the flow no longer opens on the filters. `filters`
  // is the orchestrator's name for the whole pre-draw phase, and reaching the
  // draw step from an unfiltered draft is now two moves — pick a goal, then
  // continue past the audience.
  it('advances from the goal cards through the audience to the draw step', () => {
    const onStepChange = vi.fn()
    renderAtWho({ onStepChange })

    // Choosing a goal is a stage inside `filters`, so the orchestrator hears
    // nothing about it — it only needs to know when a shape is being cut.
    expect(onStepChange).not.toHaveBeenCalled()

    fireEvent.click(
      screen.getByRole('button', { name: /^Continue \(1,500 households\)$/ }),
    )
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

    renderAtWho()

    expect(screen.getByLabelText(contactsMadeLabel as string)).toBeTruthy()
    expect(screen.getByLabelText(partyLabel as string)).toBeTruthy()
  })

  // Every group visible by scrolling, which is the decision that keeps door
  // knocking off the SMS picker: no popover, no filter-builder sub-step, and
  // no "Add condition" button in front of pills that are already on screen.
  it('shows every filter group at once, with nothing to press to reveal them', () => {
    renderAtWho()

    for (const field of filterSections.flatMap((section) => section.fields)) {
      expect(screen.getByLabelText(field.label)).toBeTruthy()
    }
    expect(screen.queryByRole('button', { name: /Add condition/i })).toBeNull()
  })

  // The canvas puts Top issue first in the shared filter pool. We hold no
  // per-voter issue attribute anywhere — no Voter column, no key in
  // voterFilterBaseSchema, and filterDimensions.catalog.ts names it a blocked
  // dimension — so the group is omitted rather than faked. Asserted here
  // because the day someone adds it to the shared config is the day it appears
  // in this flow by accident.
  it('offers no top-issue filter', () => {
    renderAtWho()

    expect(screen.queryByLabelText(/top issue/i)).toBeNull()
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

  // The gap the walkthrough reported: the draw step stated a door count and
  // never said which doors it meant, at the one moment the shape can still be
  // changed. One row per door, and a block of flats reads as the several doors
  // it is under the single coordinate the router will visit.
  it('lists the enclosed addresses, grouping the ones that share a location', () => {
    render(
      <CreateListFlow
        {...baseProps}
        step="draw"
        turfStats={turfStats(2, 3)}
        addressPreview={preview([
          {
            doors: [
              { address: '1200 W Elm St Apt 1', people: 2 },
              { address: '1200 W Elm St Apt 2', people: 1 },
            ],
          },
          { doors: [{ address: '14 N Oak Ave', people: 4 }] },
        ])}
      />,
    )

    const panel = document.getElementById('draw-step-doors')
    expect(panel).not.toBeNull()
    expect(screen.getByText('2 doors at one location')).toBeInTheDocument()
    // Three rows for the three doors the stats bar counts, and no numerals on
    // them: nothing has decided a visiting order at draw time, so a numbered
    // row would imply one the canvasser is held to.
    expect(panel?.querySelectorAll('li li')).toHaveLength(3)
    expect(panel?.querySelector('ol')).toBeNull()
    expect(screen.getByText('1200 W Elm St Apt 1')).toBeInTheDocument()
    expect(screen.getByText('1200 W Elm St Apt 2')).toBeInTheDocument()
    expect(screen.getByText('14 N Oak Ave')).toBeInTheDocument()
  })

  // The rule this feature has already broken once: one quantity gets one
  // number. The preview counts the same doors the route will be built from,
  // so it REPLACES the pack's estimate — and the hedges that estimate needed
  // go with it, because they explain a shortfall these counts don't have.
  it('reports the preview counts and retires the estimate that stood in', () => {
    const { rerender } = render(
      <CreateListFlow
        {...baseProps}
        step="draw"
        turfStats={{
          stops: 14,
          people: 22,
          households: 9,
          partyMix: [],
          ageMix: [],
        }}
        unpreviewableKeys={['age65Plus']}
      />,
    )

    expect(screen.getByText('9')).toBeInTheDocument()
    expect(screen.getByText(/The map can’t shade by/)).toBeInTheDocument()

    rerender(
      <CreateListFlow
        {...baseProps}
        step="draw"
        turfStats={{
          stops: 14,
          people: 22,
          households: 9,
          partyMix: [],
          ageMix: [],
        }}
        unpreviewableKeys={['age65Plus']}
        addressPreview={preview(
          [{ doors: [{ address: '14 N Oak Ave', people: 3 }] }],
          { stops: 6, doors: 7, people: 12 },
        )}
      />,
    )

    // The pack's 9 doors / 14 stops / 22 people are gone from the bar, not
    // beside it.
    expect(screen.getByText('7')).toBeInTheDocument()
    expect(screen.getByText('6')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.queryByText('9')).toBeNull()
    expect(screen.queryByText('14')).toBeNull()
    expect(screen.queryByText('22')).toBeNull()
    expect(screen.queryByText(/The map can’t shade by/)).toBeNull()
    // What the preview does still owe the reader: these are suppressed
    // already, so a shorter walk than this is not the expectation.
    expect(screen.getByText(/already out/)).toBeInTheDocument()
  })

  // A ring over half a district holds more stops than a route can and more
  // rows than a phone should render, so the list stops and says it stopped —
  // silently showing 150 of 900 is the reading that misleads. The shortfall is
  // counted in stops, the unit the cap above it is stated in.
  it('says how many stops it left off the list', () => {
    const { rerender } = render(
      <CreateListFlow
        {...baseProps}
        step="draw"
        addressPreview={preview([
          {
            doors: [
              { address: '1 A St', people: 1 },
              { address: '3 A St', people: 1 },
            ],
          },
        ])}
      />,
    )
    expect(screen.queryByText(/Showing the first/)).toBeNull()

    rerender(
      <CreateListFlow
        {...baseProps}
        step="draw"
        addressPreview={preview(
          [
            {
              doors: [
                { address: '1 A St', people: 1 },
                { address: '3 A St', people: 1 },
              ],
            },
          ],
          { stops: 900, doors: 2000, people: 4000 },
        )}
      />,
    )
    expect(
      screen.getByText('Showing the first 1 of 900 stops.'),
    ).toBeInTheDocument()
  })

  // The preview is a scan of people-db for one shape. Drawing must never
  // trigger one, so the panel is a request the page answers rather than
  // something the flow opens off state it already has.
  it('asks the page for the addresses instead of opening the panel itself', () => {
    const onShowAddresses = vi.fn()
    render(
      <CreateListFlow
        {...baseProps}
        step="draw"
        turfStats={turfStats(2, 3)}
        onShowAddresses={onShowAddresses}
      />,
    )

    expect(document.getElementById('draw-step-doors')).toBeNull()
    const toggle = screen.getByRole('button', { name: 'See the addresses' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(onShowAddresses).toHaveBeenCalledTimes(1)
  })

  // A list of addresses under a boundary that has since moved is the worst
  // reading this panel can produce: it looks like the answer and describes a
  // different shape. It is withdrawn, the counts fall back to the estimate,
  // and asking again is the candidate's press rather than an automatic
  // round trip on every vertex.
  it('withdraws a list whose boundary moved, and offers to ask again', () => {
    const onShowAddresses = vi.fn()
    render(
      <CreateListFlow
        {...baseProps}
        step="draw"
        turfStats={{
          stops: 14,
          people: 22,
          households: 9,
          partyMix: [],
          ageMix: [],
        }}
        previewStale
        onShowAddresses={onShowAddresses}
      />,
    )

    expect(screen.getByText(/Your boundary changed/)).toBeInTheDocument()
    expect(document.querySelectorAll('#draw-step-doors li')).toHaveLength(0)
    expect(screen.getByText('9')).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', { name: 'Show the addresses here' }),
    )
    expect(onShowAddresses).toHaveBeenCalledTimes(1)
  })

  // A failed lookup leaves the estimate standing rather than blanking the
  // step: the shape is still drawable and still savable without it.
  it('offers a retry when the lookup fails', () => {
    const onRetryAddresses = vi.fn()
    render(
      <CreateListFlow
        {...baseProps}
        step="draw"
        turfStats={{
          stops: 14,
          people: 22,
          households: 9,
          partyMix: [],
          ageMix: [],
        }}
        previewFailed
        onRetryAddresses={onRetryAddresses}
      />,
    )

    expect(screen.getByText('9')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetryAddresses).toHaveBeenCalledTimes(1)
  })

  // Nothing to list, so nothing to offer: the button would spend a scan on a
  // shape that Continue already says holds no doors.
  it('offers no address list for a shape holding nothing', () => {
    render(
      <CreateListFlow {...baseProps} step="draw" turfStats={turfStats(0, 0)} />,
    )

    expect(
      screen.queryByRole('button', { name: 'See the addresses' }),
    ).toBeNull()
  })

  // gp-api 400s a contacts-made selection from an elected-office org
  // (assertNoContactsMadeFilterForElectedOffice), so offering it would only
  // ever surface as a failed knock.
  it('hides the contacts-made group from an elected official', () => {
    const contactsMadeLabel = fieldLabel('contacts_made')

    renderAtWho({ isElectedOfficial: true })

    expect(screen.queryByLabelText(contactsMadeLabel as string)).toBeNull()
  })
})

// The step machinery the canvas asks for: four steps, or five when the draft
// needs saving as a reusable list first. Everything here is about the stepper
// being COMPUTED — a constant `of 4` under the five-step path is wrong on the
// one screen nobody scrolls back from.
describe('CreateListFlow steps', () => {
  beforeEach(() => {
    testQueryClient.clear()
    vi.clearAllMocks()
  })

  const savedLists = [
    { id: 4, name: 'Precinct 2 homeowners', households: 820, filters: {} },
    { id: 9, name: 'Super voters', households: 1_240, filters: {} },
  ]

  it('opens on door knocking’s own goal cards, and picking one advances', () => {
    render(<CreateListFlow {...baseProps} step="filters" />)

    // Door knocking's list, not social's or phone banking's: these goals are
    // about a conversation on a doorstep and have no equivalent on a channel
    // that sends a message.
    expect(screen.getByText('Discover local issues')).toBeInTheDocument()
    expect(screen.getByText('Turn out my supporters')).toBeInTheDocument()
    expect(
      screen.getByText('Hear what neighbors care about most.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Step 1 of 4')).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: /Discover local issues/ }),
    )
    expect(screen.getByText('Who do you want to reach?')).toBeInTheDocument()
    expect(screen.getByText('Step 2 of 4')).toBeInTheDocument()
  })

  // The conditional step, and the whole reason totalSteps is computed. Filters
  // cut against the whole contact universe have no saved list behind them.
  it('inserts the name step, and grows the stepper with it, once the draft is filtered', () => {
    const { rerender } = renderAtWho()
    expect(screen.getByText('Step 2 of 4')).toBeInTheDocument()

    rerender(
      <CreateListFlow
        {...baseProps}
        step="filters"
        filters={{ partyDemocrat: true }}
      />,
    )
    expect(screen.getByText('Step 2 of 5')).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: /^Continue \(1,500 households\)$/ }),
    )
    expect(screen.getByText('Name your list')).toBeInTheDocument()
    expect(screen.getByText('Step 3 of 5')).toBeInTheDocument()
    // Still inside the orchestrator's `filters` step — a step it never learns
    // about is exactly what lets this flow grow one.
    expect(baseProps.onStepChange).not.toHaveBeenCalled()
  })

  it('numbers the draw and confirm steps around the conditional one', () => {
    const { rerender } = render(
      <CreateListFlow {...baseProps} step="draw" filters={{}} />,
    )
    expect(screen.getByText('Step 3 of 4')).toBeInTheDocument()

    rerender(
      <CreateListFlow
        {...baseProps}
        step="confirm"
        filters={{ partyDemocrat: true }}
      />,
    )
    expect(screen.getByText('Step 5 of 5')).toBeInTheDocument()
  })

  it('names the saved list and the route separately when both were asked for', async () => {
    const bodies: Array<{ kind: string; name: unknown }> = []
    api.mock('POST /v1/voters/voter-file/filter', ({ body }) => {
      bodies.push({ kind: 'filter', name: (body as { name: string }).name })
      return { status: 200, data: { id: 21 } }
    })
    api.mock('POST /v1/door-knocking/turfs', ({ body }) => {
      bodies.push({ kind: 'turf', name: (body as { name: string }).name })
      return {
        status: 200,
        data: {
          id: 5,
          voterFileFilterId: 21,
          name: 'Tuesday evening',
          color: '#2563eb',
          geoPoly: {
            type: 'Polygon' as const,
            coordinates: [[...OPEN_RING, OPEN_RING[0] as [number, number]]],
          },
          locked: false,
          doorCount: null,
          peopleCount: null,
          loggedCount: null,
          completedAt: null,
          archivedAt: null,
          createdAt: new Date('2026-08-20T00:00:00Z'),
          updatedAt: new Date('2026-08-20T00:00:00Z'),
        },
      }
    })
    const onSaved = vi.fn()

    const { rerender } = renderAtWho({ filters: { partyDemocrat: true } })
    fireEvent.click(
      screen.getByRole('button', { name: /^Continue \(1,500 households\)$/ }),
    )
    fireEvent.change(screen.getByLabelText('List name'), {
      target: { value: 'Precinct 2 homeowners' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    rerender(
      <CreateListFlow
        {...baseProps}
        step="confirm"
        filters={{ partyDemocrat: true }}
        onSaved={onSaved}
      />,
    )
    // The route name arrives seeded from the list the candidate just named,
    // then they rename the route without renaming the audience behind it.
    expect(screen.getByLabelText('Route name')).toHaveValue(
      'Precinct 2 homeowners',
    )
    fireEvent.change(screen.getByLabelText('Route name'), {
      target: { value: 'Tuesday evening' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save and exit' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(false))
    expect(bodies).toEqual([
      { kind: 'filter', name: 'Precinct 2 homeowners' },
      { kind: 'turf', name: 'Tuesday evening' },
    ])
  })

  // The #1385 lesson: a card label doubling as a default title renamed live
  // records. The suggestion is its own record, so it reads as a list name
  // rather than as the goal it came from.
  it('seeds the route name from the purpose when no list was named', () => {
    const { rerender } = render(
      <CreateListFlow {...baseProps} step="filters" />,
    )
    fireEvent.click(
      screen.getByRole('button', { name: /Turn out my supporters/ }),
    )
    rerender(<CreateListFlow {...baseProps} step="confirm" />)

    expect(screen.getByLabelText('Route name')).toHaveValue('Turnout walk')
  })

  // The canvas's counts-in-parentheses: door knocking shows the overall count
  // beside every list, which is why it does not repeat one per row elsewhere.
  it('counts every list in the picker, and drops the name step when one is chosen', () => {
    const onFiltersChange = vi.fn()
    renderAtWho({
      savedLists,
      allContactsHouseholds: 12_000,
      filters: { partyDemocrat: true },
      onFiltersChange,
    })

    expect(
      screen.getByRole('radio', { name: /All contacts \(12,000\)/ }),
    ).toBeTruthy()
    expect(
      screen.getByRole('radio', { name: /Precinct 2 homeowners \(820\)/ }),
    ).toBeTruthy()
    // Filtered against the whole universe, so the flow is offering to save it.
    expect(screen.getByText('Step 2 of 5')).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('radio', { name: /Super voters \(1,240\)/ }),
    )

    // Starting from a named list is the alternative to naming one, so the
    // fifth step goes away and the draft becomes the list's own filters.
    expect(screen.getByText('Step 2 of 4')).toBeInTheDocument()
    expect(onFiltersChange).toHaveBeenCalledWith({})
  })

  it('renders a list with no count yet rather than hiding it', () => {
    renderAtWho({
      savedLists: [
        { id: 4, name: 'Precinct 2', households: null, filters: {} },
      ],
      allContactsHouseholds: null,
    })

    expect(screen.getByRole('radio', { name: /^Precinct 2/ })).toBeTruthy()
    expect(screen.getByRole('radio', { name: /^All contacts/ })).toBeTruthy()
  })

  // What adopting OutreachFlowShell would have bought, built here instead:
  // closing a flow someone has put work into asks first, and a pristine one
  // still closes on the first press.
  it('confirms a discard only once there is something to discard', () => {
    const onClose = vi.fn()
    // Pristine means no shape either — a ring is work, however it got there.
    const { rerender } = render(
      <CreateListFlow
        {...baseProps}
        step="filters"
        ring={null}
        drawPointCount={0}
        onClose={onClose}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Close list creation' }))
    expect(onClose).toHaveBeenCalledTimes(1)

    rerender(
      <CreateListFlow
        {...baseProps}
        step="filters"
        ring={null}
        drawPointCount={0}
        filters={{ partyDemocrat: true }}
        onClose={onClose}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Close list creation' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Discard this list?')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('returns from the draw step to whichever pre-draw step was left', () => {
    const onStepChange = vi.fn()
    const { rerender } = renderAtWho({
      filters: { partyDemocrat: true },
      onStepChange,
    })
    fireEvent.click(
      screen.getByRole('button', { name: /^Continue \(1,500 households\)$/ }),
    )
    fireEvent.change(screen.getByLabelText('List name'), {
      target: { value: 'Homeowners' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(onStepChange).toHaveBeenCalledWith('draw')

    rerender(
      <CreateListFlow
        {...baseProps}
        step="draw"
        filters={{ partyDemocrat: true }}
        onStepChange={onStepChange}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    // The page hears `filters`, which is what resets the address panel; the
    // flow remembers it was the name step and puts the typed name back.
    expect(onStepChange).toHaveBeenLastCalledWith('filters')

    rerender(
      <CreateListFlow
        {...baseProps}
        step="filters"
        filters={{ partyDemocrat: true }}
        onStepChange={onStepChange}
      />,
    )
    expect(screen.getByLabelText('List name')).toHaveValue('Homeowners')
  })
})
