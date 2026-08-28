import { ComponentProps, useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  DoorKnockingRoutePayload,
  NotAVoterReason,
  RoutePayloadTarget,
  RouteTargetActivity,
} from '@goodparty_org/contracts'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import WalkView, { stopNumeralColor } from './WalkView'
import type { LiveLocation } from './useLiveLocation'
import {
  PROGRESS_LEGEND_ORDER,
  PROGRESS_STATUS_ORDER,
  STATUS_DOT_COLORS,
  STATUS_LABELS,
  STATUS_RGB,
} from './statusPresentation'

// The marked stop now lives on the page, because the map rings the same stop
// the list marks and the canvas can only be handed a prop. This is the
// orchestrator's half of that — `useWalkMapSession` in production — so the
// suite can go on asserting the list's own behaviour: the view still decides
// where the mark goes and reports it, and reads back what it reported.
// The live-location half of the same orchestrator. The watch belongs to the
// page (the map draws the dot and outlives the walk), so the harness plays it:
// off until the pill is pressed, then whatever `liveLocation` says. Defaulting
// to `off` rather than making every test supply one keeps the suite about the
// list, and lets the few tests that are about the pill hand it a reading.
const WalkHarness = ({
  onSelectStop,
  liveLocation,
  ...props
}: Omit<
  ComponentProps<typeof WalkView>,
  | 'selectedStopId'
  | 'onSelectStop'
  | 'liveLocation'
  | 'liveLocationEnabled'
  | 'onToggleLiveLocation'
> & {
  onSelectStop?: (stopId: number) => void
  liveLocation?: LiveLocation
}) => {
  const [selectedStopId, setSelectedStopId] = useState<number | null>(null)
  const [liveLocationEnabled, setLiveLocationEnabled] = useState(false)
  return (
    <WalkView
      {...props}
      selectedStopId={selectedStopId}
      onSelectStop={(stopId) => {
        setSelectedStopId(stopId)
        onSelectStop?.(stopId)
      }}
      liveLocation={
        liveLocation ??
        (liveLocationEnabled
          ? { status: 'locating', fix: null, approximate: false }
          : { status: 'off', fix: null, approximate: false })
      }
      liveLocationEnabled={liveLocationEnabled}
      onToggleLiveLocation={setLiveLocationEnabled}
    />
  )
}

vi.mock('helpers/analyticsHelper', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('helpers/analyticsHelper')>()
  return { ...actual, trackEvent: vi.fn() }
})

const routePayload: DoorKnockingRoutePayload = {
  route: {
    id: 5,
    doorKnockingTurfId: 3,
    mode: 'walk',
    loop: true,
    totalSeconds: 1860,
    totalMeters: 2400,
    stopCount: 2,
    createdAt: new Date('2026-07-21T00:00:00Z'),
  },
  pathGeometry: null,
  stops: [
    // Served out of order on purpose: the view must sort by seq.
    {
      id: 12,
      seq: 2,
      lat: 36.17,
      lng: -86.77,
      displayAddress: '210 Cedar Row',
      legSeconds: 300,
      legMeters: 380,
      addresses: [
        {
          addressKey: '210|cedar|row',
          address: '210 Cedar Row',
          targets: [
            {
              stopTargetId: 22,
              personId: 'person-2',
              name: 'Marisol Vega',
              age: 44,
              politicalParty: 'Independent',
              cellPhone: '(615) 555-0142',
              landline: null,
              knockStatus: 'supporter',
              mayHaveMoved: false,
              doNotKnock: false,
            },
          ],
          otherResidents: [{ name: 'Ruben Vega' }],
        },
      ],
    },
    {
      id: 11,
      seq: 1,
      lat: 36.16,
      lng: -86.78,
      displayAddress: '105 Elm St',
      legSeconds: 0,
      legMeters: 0,
      addresses: [
        {
          addressKey: '105|elm|st',
          address: '105 Elm St',
          targets: [
            {
              stopTargetId: 21,
              personId: 'person-1',
              name: 'Dorian Fen',
              age: 31,
              politicalParty: null,
              cellPhone: null,
              landline: null,
              knockStatus: 'unknown',
              mayHaveMoved: true,
              doNotKnock: false,
            },
          ],
          otherResidents: [],
        },
      ],
    },
  ],
}

// Every fixture stop has one resident, so clicking the stop row opens the
// person sheet directly (multi-resident stops expand instead).
const openPersonSheet = async (address: string) => {
  await waitFor(() => expect(screen.getByText(address)).toBeInTheDocument())
  fireEvent.click(screen.getByText(address))
  await waitFor(() =>
    expect(screen.getByText('Log this door')).toBeInTheDocument(),
  )
}

// The walkthrough answers one question at a time, so a test has to say which
// question it is answering: two of the rows both offer "Yes".
const answerQuestion = (label: string, option: string) =>
  fireEvent.click(
    within(screen.getByText(label).parentElement as HTMLElement).getByRole(
      'radio',
      { name: option },
    ),
  )

// Save is the only thing that logs a door, and it appears once the branch the
// canvasser walked has nothing left to ask.
const saveKnock = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))

const knockNotHome = () => {
  answerQuestion('Did they answer?', 'Not home')
  saveKnock()
}

const knockNotAVoter = () => {
  answerQuestion('Did they answer?', 'Answered')
  answerQuestion('Did they engage?', 'Not voter')
  saveKnock()
}

const closePersonSheet = async () => {
  fireEvent.click(
    screen.getAllByRole('button', { name: 'Close person details' }).pop()!,
  )
  await waitFor(() => expect(screen.queryByText('Log this door')).toBeNull())
}

// A second resident behind the first stop's door, so the collapsed row has a
// household to count rather than a single person to name.
const withHousehold = (
  payload: DoorKnockingRoutePayload,
): DoorKnockingRoutePayload => ({
  ...payload,
  stops: payload.stops.map((stop) =>
    stop.id === 11
      ? {
          ...stop,
          addresses: stop.addresses.map((address) => ({
            ...address,
            targets: [
              ...address.targets,
              {
                ...(address.targets[0] as RoutePayloadTarget),
                stopTargetId: 23,
                personId: 'person-3',
                name: 'Winnie Fen',
              },
            ],
          })),
        }
      : stop,
  ),
})

// The stop rows are the only list items on this surface, and their button is
// what carries `aria-current` — the row saying it is the stop the walk is on.
const stopRow = (index: number): HTMLElement =>
  (screen.getAllByRole('listitem')[index] as HTMLElement).querySelector(
    'button',
  ) as HTMLElement

describe('WalkView', () => {
  beforeEach(() => {
    testQueryClient.clear()
    vi.mocked(trackEvent).mockClear()
    api.mock('GET /v1/door-knocking/turfs/:id/route', {
      status: 200,
      data: routePayload,
    })
  })

  it('renders stops in seq order with totals and the logged counter', async () => {
    render(<WalkHarness turfId={3} />)

    await waitFor(() =>
      expect(screen.getByText('105 Elm St')).toBeInTheDocument(),
    )
    // Distance comes from the same route payload as the duration; 2400m.
    // "travel" and not the bare duration: Geoapify times the movement between
    // stops and nothing at them, so unqualified it read as the cost of the
    // outing. The details sheet labels the same number the same way.
    expect(
      screen.getByText(/2 doors · 31m travel · 1.5 mi/),
    ).toBeInTheDocument()
    expect(screen.getByText('1/2 logged')).toBeInTheDocument()
    const items = screen.getAllByRole('listitem')
    expect(within(items[0] as HTMLElement).getByText('Dorian Fen')).toBeTruthy()
    expect(
      within(items[1] as HTMLElement).getByText('Marisol Vega'),
    ).toBeTruthy()
  })

  // The canvas segments its bar by outcome. Ours was one blue bar with the
  // counts underneath, recorded as a deliberate departure — overturned by the
  // product owner on 2026-08-25 (audit item 14). `unknown` is deliberately not
  // a segment: the track showing through for it is what keeps the bar a
  // reading of progress rather than a stacked chart that is full on a walk
  // where nothing has happened.
  it('colours the progress bar by outcome, leaving the unlogged as track', async () => {
    render(<WalkHarness turfId={3} />)

    await waitFor(() =>
      expect(screen.getByText('1/2 logged')).toBeInTheDocument(),
    )

    const segments = Array.from(
      document.querySelectorAll<HTMLElement>('[data-status]'),
    )
    expect(segments.map((segment) => segment.dataset.status)).toEqual([
      ...PROGRESS_STATUS_ORDER,
    ])
    expect(segments).toHaveLength(PROGRESS_LEGEND_ORDER.length - 1)
    expect(segments.some((s) => s.dataset.status === 'unknown')).toBe(false)

    // The words under the bar run the same way the segments do, with the one
    // status that has no segment in the canvas's place among them.
    const legend = within(
      screen.getByRole('group', { name: 'Outcomes so far' }),
    ).getAllByText(/\w/, { selector: 'span.inline-flex' })
    expect(
      legend.map((entry) =>
        entry.textContent?.split(' ').slice(0, -1).join(' '),
      ),
    ).toEqual(PROGRESS_LEGEND_ORDER.map((status) => STATUS_LABELS[status]))

    // Marisol is the one logged door of two, and she is a supporter.
    const supporter = segments.find((s) => s.dataset.status === 'supporter')!
    expect(supporter).toHaveStyle({
      width: '50%',
      backgroundColor: STATUS_DOT_COLORS.supporter,
    })
    // Everything unlogged leaves the bar alone.
    expect(
      segments
        .filter((s) => s.dataset.status !== 'supporter')
        .every((s) => s.style.width === '0%'),
    ).toBe(true)
  })

  // The canvas's bubble is `secondary-light` on `secondary-dark`. Ours had
  // drifted to the near-black `tertiary-dark`, which reads as a filled control
  // rather than as a count. The WORD is a separate, still-correct decision:
  // "logged" and never the canvas's "reached", because not-home, inaccessible
  // and refused all satisfy this predicate.
  it('keeps our word for the counter and the canvas’s colour', async () => {
    render(<WalkHarness turfId={3} />)

    const bubble = await screen.findByText('1/2 logged')
    expect(bubble.className).toContain('bg-secondary-light')
    expect(bubble.className).toContain('text-secondary-dark')
    expect(bubble.className).not.toContain('tertiary')
  })

  // The Aug 14 walkthrough took these numerals out; the 2026-08-20 product call
  // put them back, and this test was written to encode their absence. The map
  // draws `seq` on every pin, so a list with no numerals gives a canvasser no
  // way to turn the pin under their thumb into the row that opens its door.
  // `seq` and not the DOM position, so the list, the pins and the printed sheet
  // cannot name the same stop three ways — the fixture is served out of order
  // for exactly that reason.
  it('numbers each stop by its route order, on the circle that carries its status', async () => {
    render(<WalkHarness turfId={3} />)

    await waitFor(() =>
      expect(screen.getByText('105 Elm St')).toBeInTheDocument(),
    )
    const rows = screen.getAllByRole('listitem')

    const elmDot = (rows[0] as HTMLElement).querySelector('span.h-7')
    expect(elmDot).toHaveTextContent('Stop 1')
    expect(elmDot).toHaveStyle({ backgroundColor: STATUS_DOT_COLORS.unknown })
    const cedarDot = (rows[1] as HTMLElement).querySelector('span.h-7')
    expect(cedarDot).toHaveTextContent('Stop 2')
    expect(cedarDot).toHaveStyle({
      backgroundColor: STATUS_DOT_COLORS.supporter,
    })
  })

  // The stop's numeral and its people count sit one gap apart on the row, so a
  // bare "1" beside "Stop 1" named neither quantity — the canvas puts a person
  // glyph in front of the count AND the noun after it for exactly this reason,
  // and a screen reader gets none of that layout at all.
  it('says what the people count on a stop row counts', async () => {
    api.mock('GET /v1/door-knocking/turfs/:id/route', {
      status: 200,
      data: withHousehold(routePayload),
    })
    render(<WalkHarness turfId={3} />)

    await waitFor(() =>
      expect(screen.getByText('105 Elm St')).toBeInTheDocument(),
    )

    expect(within(stopRow(0)).getByText(/2 people/)).toBeInTheDocument()
    expect(within(stopRow(0)).getByText(/to knock/)).toBeInTheDocument()
  })

  // The canvas's expanded door: a tinted well under the stop, one row per
  // resident, each led by a person glyph sitting where the stop's own name
  // begins and closed by a bordered status pill. Ours had the indent and
  // nothing else — no glyph, no rules, and a bare dot and label floating where
  // the pill goes, which ran together into one block of grey at three or four
  // residents.
  it('expands a household into the canvas’s resident rows', async () => {
    api.mock('GET /v1/door-knocking/turfs/:id/route', {
      status: 200,
      data: withHousehold(routePayload),
    })
    render(<WalkHarness turfId={3} />)

    await waitFor(() =>
      expect(screen.getByText('105 Elm St')).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByText('105 Elm St'))

    // The row expands rather than opening a sheet: the canvasser picks.
    await waitFor(() =>
      expect(screen.getAllByText('Dorian Fen')).toHaveLength(2),
    )
    expect(screen.queryByText('Log this door')).toBeNull()

    const residentRow = screen
      .getAllByText('Winnie Fen')
      .pop()!
      .closest('button') as HTMLElement
    // The glyph starts where the stop's name does, so the residents read as
    // belonging to the address above them rather than as more stops.
    expect(residentRow.className).toContain('pl-14')
    expect(residentRow.querySelector('svg.lucide-user')).toBeTruthy()
    // A rule between every row, so four residents are four rows.
    expect(residentRow.className).toContain('border-t')
    // The status is a bordered pill, as in the canvas.
    const pill = within(residentRow).getByText('Support unknown')
    expect(pill.className).toContain('rounded-full')
    expect(pill.className).toContain('border')
  })

  // globals.css gives every `<li>` inside a `data-slot` element `display:
  // flex`, and `DashboardLayout`'s sidebar wrapper puts this list in that
  // scope, so the stop row and its expanded door were laid out as sibling flex
  // items side by side and the residents' names truncated. jsdom has no
  // layout, so this asserts the override is present rather than its effect —
  // the rendered proof is in the PR's screenshots.
  it('keeps the expanded door stacked under its stop row', async () => {
    api.mock('GET /v1/door-knocking/turfs/:id/route', {
      status: 200,
      data: withHousehold(routePayload),
    })
    render(<WalkHarness turfId={3} />)

    await waitFor(() =>
      expect(screen.getByText('105 Elm St')).toBeInTheDocument(),
    )
    const row = screen.getAllByRole('listitem')[0] as HTMLElement
    expect(row.className.split(/\s+/)).toContain('block')
  })

  // A one-resident stop opens its sheet instead of expanding, so it is the one
  // stop whose status never gets labelled anywhere else. It used to close on a
  // bare coloured dot, leaving a canvasser to match a 6px circle against a
  // legend two cards up — the canvas spells this row's status out, and so does
  // ours now.
  it('names the outcome in words on a stop with a single resident', async () => {
    render(<WalkHarness turfId={3} />)

    await waitFor(() =>
      expect(screen.getByText('105 Elm St')).toBeInTheDocument(),
    )

    // Dorian is unreached; Marisol is already a supporter.
    expect(within(stopRow(0)).getByText('Support unknown')).toBeInTheDocument()
    expect(within(stopRow(1)).getByText('Supporter')).toBeInTheDocument()
    // And no head count at all: "1 person" is a quantity nobody asked for.
    expect(within(stopRow(0)).queryByText(/person/)).toBeNull()
  })

  // A row tap and a pin tap set one selection, so the numbered row and the
  // numbered pin are two views of where the canvasser is. It outlives the sheet
  // deliberately: the door just worked is the one worth keeping marked, and a
  // mark that cleared on close would leave a fifty-row list with nothing saying
  // where in the street the walk had got to.
  it('marks the stop the walk is on, and keeps it marked after the sheet closes', async () => {
    render(<WalkHarness turfId={3} />)
    await openPersonSheet('105 Elm St')

    expect(stopRow(0)).toHaveAttribute('aria-current', 'true')
    expect(stopRow(1)).not.toHaveAttribute('aria-current')

    await closePersonSheet()

    expect(stopRow(0)).toHaveAttribute('aria-current', 'true')
  })

  // The canvas keeps the walk's paper in the page header, not in the control
  // row under the map, and calls it PDF. The link itself is asserted where it
  // now lives (`NativeDoorKnockingPage.test.tsx`); what this file has to keep
  // proving is that the row below the map does not grow a second one.
  it('leaves the walk’s paper to the page header', async () => {
    render(<WalkHarness turfId={3} />)

    await waitFor(() =>
      expect(screen.getByText('105 Elm St')).toBeInTheDocument(),
    )
    expect(screen.queryByRole('link', { name: 'Print list' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'PDF' })).toBeNull()
  })

  // The canvas's walk control row, in the canvas's order: the live-location
  // switch first, then the facts about the route being walked. The mode and
  // loop chips are read-only on purpose — a route is bought for one mode and
  // cannot be re-bought from inside itself — so the row has exactly one button.
  it('leads the control row with the live-location switch', async () => {
    render(<WalkHarness turfId={3} />)

    await waitFor(() =>
      expect(screen.getByText('105 Elm St')).toBeInTheDocument(),
    )

    const pill = screen.getByRole('button', { name: 'My live location' })
    expect(pill).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(pill)

    expect(
      screen.getByRole('button', { name: 'My live location' }),
    ).toHaveAttribute('aria-pressed', 'true')
    // The route facts beside it stay facts.
    expect(screen.getByText('Walking').tagName).toBe('SPAN')
    expect(screen.getByText('Loop').tagName).toBe('SPAN')
  })

  // ADR 0007. The marker has to survive walking on to the next stop, so it
  // patches the route cache the way a recorded knock does.
  it('marks a flagged door in the list and withholds the log form', async () => {
    api.mock('POST /v1/door-knocking/do-not-knock', {
      status: 200,
      data: { personId: 'person-1', doNotKnock: true },
    })

    render(<WalkHarness turfId={3} />)
    await openPersonSheet('105 Elm St')

    fireEvent.click(screen.getByRole('button', { name: /don.t knock/i }))

    await waitFor(() => expect(screen.queryByText('Log this door')).toBeNull())
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()

    // Closing the sheet leaves the marker on the stop row itself. A
    // single-resident stop never expands, so this is the only place a
    // canvasser sees it before walking up.
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Close person details' }).pop()!,
    )
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull(),
    )
    const elmRow = screen.getAllByRole('listitem')[0] as HTMLElement
    expect(within(elmRow).getByText('Do not knock')).toBeInTheDocument()
  })

  // ADR 0007. A flagged door keeps `knockStatus: 'unknown'`, so counting it
  // would strand a canvasser who correctly skipped it below 100% and leave it
  // sitting under the "Support unknown" chip as work still to do.
  it('drops a flagged door out of the progress counts', async () => {
    api.mock('POST /v1/door-knocking/do-not-knock', {
      status: 200,
      data: { personId: 'person-1', doNotKnock: true },
    })

    // Scoped to the legend by name: the same seven words also label a
    // one-resident stop row now, and an unscoped lookup would find both.
    const unknownChip = () =>
      within(screen.getByRole('group', { name: 'Outcomes so far' })).getByText(
        /Support unknown/,
        { selector: 'span' },
      )

    render(<WalkHarness turfId={3} />)
    // Dorian is the unreached door of the two; Marisol is already a supporter.
    await waitFor(() =>
      expect(screen.getByText('1/2 logged')).toBeInTheDocument(),
    )
    expect(unknownChip()).toHaveTextContent('Support unknown 1')

    await openPersonSheet('105 Elm St')
    fireEvent.click(screen.getByRole('button', { name: /don.t knock/i }))
    // Undo appearing is the flag landing; asserting the counts before the
    // mutation settles would read the pre-patch cache.
    await screen.findByRole('button', { name: 'Undo' })
    await closePersonSheet()

    expect(screen.getByText('1/1 logged')).toBeInTheDocument()
    expect(unknownChip()).toHaveTextContent('Support unknown 0')
  })

  // `unknown` outranks every other status in the rollup, so before flagged
  // residents were excluded a single do-not-knock neighbor held the stop on the
  // grey "still to knock" dot no matter how much of the household was logged.
  it('colors a stop from its knockable residents only', async () => {
    const mixedHousehold: DoorKnockingRoutePayload = {
      ...routePayload,
      stops: [
        {
          ...routePayload.stops[0]!,
          addresses: [
            {
              addressKey: '210|cedar|row',
              address: '210 Cedar Row',
              otherResidents: [],
              targets: [
                {
                  ...routePayload.stops[0]!.addresses[0]!.targets[0]!,
                  knockStatus: 'supporter',
                },
                {
                  ...routePayload.stops[0]!.addresses[0]!.targets[0]!,
                  stopTargetId: 23,
                  personId: 'person-3',
                  name: 'Ruben Vega',
                  knockStatus: 'unknown',
                  doNotKnock: true,
                },
              ],
            },
          ],
        },
      ],
    }
    api.mock('GET /v1/door-knocking/turfs/:id/route', {
      status: 200,
      data: mixedHousehold,
    })

    render(<WalkHarness turfId={3} />)

    await waitFor(() =>
      expect(screen.getByText('210 Cedar Row')).toBeInTheDocument(),
    )
    const row = screen.getAllByRole('listitem')[0] as HTMLElement
    // The stop's own circle, the one the rollup colors and the one its number
    // is printed on — as against the per-resident dots asserted below.
    expect(row.querySelector('span.h-7')).toHaveStyle({
      backgroundColor: STATUS_DOT_COLORS.supporter,
    })

    // ADR 0007. The flagged resident gets no per-person dot either — a status
    // dot beside the "Do not knock" label would say the opposite of the label.
    const personDots = Array.from(row.querySelectorAll('span.h-1\\.5'))
    expect(personDots).toHaveLength(1)
    expect(personDots[0]).toHaveStyle({
      backgroundColor: STATUS_DOT_COLORS.supporter,
    })
  })

  it('records an answered knock through the person sheet', async () => {
    const posted: unknown[] = []
    api.mock('POST /v1/door-knocking/interactions', ({ body }) => {
      posted.push(body)
      return {
        status: 200,
        data: { personId: 'person-1', knockStatus: 'supporter' },
      }
    })

    render(<WalkHarness turfId={3} />)
    await openPersonSheet('105 Elm St')
    expect(
      screen.getByText('May have moved since this route was built.'),
    ).toBeInTheDocument()

    answerQuestion('Did they answer?', 'Answered')
    answerQuestion('Did they engage?', 'Engaged')
    answerQuestion('Do they support you?', 'Yes')
    answerQuestion('Will they vote this election?', 'Unsure')
    saveKnock()

    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toMatchObject({
      stopTargetId: 21,
      outcome: 'answered',
      supportAnswer: 'supporter',
      willVote: 'unsure',
    })
    expect((posted[0] as { clientKey: string }).clientKey).toMatch(
      /[0-9a-f-]{36}/,
    )

    // Sheet closes and the logged counter reflects the new status.
    await waitFor(() => expect(screen.queryByText('Log this door')).toBeNull())
    expect(screen.getByText('2/2 logged')).toBeInTheDocument()

    expect(trackEvent).toHaveBeenCalledWith(EVENTS.DoorKnocking.DoorLogged, {
      outcome: 'answered',
      supportAnswer: 'supporter',
      willVote: 'unsure',
      knockStatus: 'supporter',
      hasNote: false,
    })
  })

  // The note is free text about a named voter, so only its existence travels.
  // Walked on the door that never opened, because that is the majority of
  // them and the one the note field was restored for.
  it('reports that a note was written without shipping what it said', async () => {
    api.mock('POST /v1/door-knocking/interactions', {
      status: 200,
      data: { personId: 'person-1', knockStatus: 'not_home' },
    })

    render(<WalkHarness turfId={3} />)
    await openPersonSheet('105 Elm St')
    answerQuestion('Did they answer?', 'Not home')
    fireEvent.change(screen.getByPlaceholderText('Notes (optional)'), {
      target: { value: 'Dog in the yard, come back Saturday' },
    })
    saveKnock()

    await waitFor(() =>
      expect(trackEvent).toHaveBeenCalledWith(EVENTS.DoorKnocking.DoorLogged, {
        outcome: 'not_home',
        knockStatus: 'not_home',
        hasNote: true,
      }),
    )
    const logged = vi
      .mocked(trackEvent)
      .mock.calls.find(([name]) => name === EVENTS.DoorKnocking.DoorLogged)
    expect(JSON.stringify(logged?.[1])).not.toContain('Dog in the yard')
  })

  it('does not report a door the server refused', async () => {
    api.mock('POST /v1/door-knocking/interactions', { status: 500, data: {} })

    render(<WalkHarness turfId={3} />)
    await openPersonSheet('105 Elm St')
    knockNotHome()

    await waitFor(() =>
      expect(screen.getByText(/Saving failed/)).toBeInTheDocument(),
    )
    expect(trackEvent).not.toHaveBeenCalled()
    // A failed door must not advance past itself.
    expect(screen.getByText('Log this door')).toBeInTheDocument()
  })

  it('replays the same clientKey when the sheet is closed and reopened', async () => {
    const keys: string[] = []
    let failFirst = true
    api.mock('POST /v1/door-knocking/interactions', ({ body }) => {
      keys.push((body as { clientKey: string }).clientKey)
      if (failFirst) {
        failFirst = false
        return { status: 500, data: {} }
      }
      return {
        status: 200,
        data: { personId: 'person-1', knockStatus: 'not_home' },
      }
    })

    render(<WalkHarness turfId={3} />)
    await openPersonSheet('105 Elm St')
    knockNotHome()
    await waitFor(() => expect(keys).toHaveLength(1))

    // Close and reopen the sheet — the remount must not mint a new key,
    // or the server-side upsert can't dedupe the retry.
    await closePersonSheet()
    await openPersonSheet('105 Elm St')
    knockNotHome()
    await waitFor(() => expect(keys).toHaveLength(2))
    expect(keys[1]).toBe(keys[0])
  })

  it('mints a fresh clientKey for the next knock after a success', async () => {
    const keys: string[] = []
    api.mock('POST /v1/door-knocking/interactions', ({ body }) => {
      keys.push((body as { clientKey: string }).clientKey)
      return {
        status: 200,
        data: { personId: 'person-1', knockStatus: 'not_home' },
      }
    })

    render(<WalkHarness turfId={3} />)
    await openPersonSheet('105 Elm St')
    knockNotHome()
    await waitFor(() => expect(keys).toHaveLength(1))
    await waitFor(() => expect(screen.queryByText('Log this door')).toBeNull())

    await openPersonSheet('105 Elm St')
    knockNotHome()
    await waitFor(() => expect(keys).toHaveLength(2))
    expect(keys[1]).not.toBe(keys[0])
  })

  it('never sends answers with a non-answered outcome', async () => {
    const posted: unknown[] = []
    api.mock('POST /v1/door-knocking/interactions', ({ body }) => {
      posted.push(body)
      return {
        status: 200,
        data: { personId: 'person-1', knockStatus: 'not_home' },
      }
    })

    render(<WalkHarness turfId={3} />)
    await openPersonSheet('105 Elm St')
    // Walk the engaged branch, then back out to Not home — the answers picked
    // inside it must not leak onto an outcome the contract rejects them for.
    answerQuestion('Did they answer?', 'Answered')
    answerQuestion('Did they engage?', 'Engaged')
    answerQuestion('Do they support you?', 'Yes')
    answerQuestion('Will they vote this election?', 'Yes')
    knockNotHome()

    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toMatchObject({ outcome: 'not_home' })
    expect(posted[0]).not.toHaveProperty('supportAnswer')
    expect(posted[0]).not.toHaveProperty('willVote')
  })
})

// ADR 0008. The reason behind a `not_a_voter` outcome: optional, asked after
// the door is already saved, and suppressing the resident once it is given.
describe('WalkView not-a-voter reason', () => {
  beforeEach(() => {
    testQueryClient.clear()
    vi.mocked(trackEvent).mockClear()
    api.mock('GET /v1/door-knocking/turfs/:id/route', {
      status: 200,
      data: routePayload,
    })
  })

  const logNotAVoter = () =>
    api.mock('POST /v1/door-knocking/interactions', {
      status: 200,
      data: { personId: 'person-1', knockStatus: 'not_a_voter' },
    })

  // The route as the server would build it now. Dorian's knock status and both
  // flags are read live at serve time (ADR 0008), so a serve asked for mid-walk
  // reflects whatever has been written since the walk opened.
  const serveWithDorian = (
    live: Partial<RoutePayloadTarget>,
  ): DoorKnockingRoutePayload => ({
    ...routePayload,
    stops: routePayload.stops.map((stop) =>
      stop.id !== 11
        ? stop
        : {
            ...stop,
            addresses: stop.addresses.map((address) => ({
              ...address,
              targets: address.targets.map((target) => ({
                ...target,
                ...live,
              })),
            })),
          },
    ),
  })

  const knockRow: RouteTargetActivity = {
    type: 'DOOR_KNOCK',
    date: '2026-08-18T18:00:00.000Z',
    data: {
      activityId: 'dk-1',
      outcome: 'not_a_voter',
      supportAnswer: null,
      note: null,
      manual: false,
    },
  }

  const flagRow: RouteTargetActivity = {
    type: 'STATUS_CHANGE',
    date: '2026-08-18T18:05:00.000Z',
    data: {
      activityId: 'se-1',
      field: 'not_a_voter',
      fromLabel: null,
      toLabel: 'Moved away',
      actorName: 'Rosa Iyer',
      actorUserId: 77,
      source: 'manual',
    },
  }

  // A live serve rather than a frozen payload, because both writes below are
  // things the next serve genuinely reflects — and because answering the
  // follow-up now asks for one (ADR 0009's deferred refresh), so a static mock
  // would answer that request by walking the write it had just accepted back
  // off. Each write also adds the feed row it really produces, which is the row
  // the refresh exists to fetch.
  const mockLiveRoute = () => {
    const live: Partial<RoutePayloadTarget> = {}
    let serves = 0

    api.mock('POST /v1/door-knocking/interactions', () => {
      live.knockStatus = 'not_a_voter'
      live.history = [knockRow]
      return {
        status: 200,
        data: { personId: 'person-1', knockStatus: 'not_a_voter' },
      }
    })
    api.mock('POST /v1/door-knocking/not-a-voter', ({ body }) => {
      const { value } = body as { value: NotAVoterReason | 'cleared' }
      live.notAVoterReason = value === 'cleared' ? undefined : value
      live.history = [flagRow, knockRow]
      return {
        status: 200,
        data: { personId: 'person-1', notAVoterReason: live.notAVoterReason },
      }
    })
    api.mock('GET /v1/door-knocking/turfs/:id/route', () => {
      serves += 1
      return { status: 200, data: serveWithDorian(live) }
    })

    return () => serves
  }

  // The prototype asks Moved/Deceased inside the walkthrough, before Save.
  // Here it stays behind the save: the reason is optional, and a door that is
  // logged only once its optional follow-up is answered is a door that gets
  // lost when the canvasser walks away mid-question.
  it('logs the door on Save, with no reason attached', async () => {
    const posted: unknown[] = []
    api.mock('POST /v1/door-knocking/interactions', ({ body }) => {
      posted.push(body)
      return {
        status: 200,
        data: { personId: 'person-1', knockStatus: 'not_a_voter' },
      }
    })

    render(<WalkHarness turfId={3} />)
    await openPersonSheet('105 Elm St')
    knockNotAVoter()

    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toMatchObject({
      stopTargetId: 21,
      outcome: 'not_a_voter',
    })
    expect(trackEvent).toHaveBeenCalledWith(EVENTS.DoorKnocking.DoorLogged, {
      outcome: 'not_a_voter',
      knockStatus: 'not_a_voter',
      hasNote: false,
    })
    // Nothing about a reason reaches the knock write — it is a different field
    // on a different endpoint.
    expect(JSON.stringify(posted[0])).not.toContain('moved')
  })

  // Advancing here would ask "what happened?" and take the answer away in the
  // same frame. The door is saved either way, so walking off costs nothing.
  it('holds the sheet on the logged door so the follow-up can be answered', async () => {
    logNotAVoter()

    render(<WalkHarness turfId={3} />)
    await openPersonSheet('105 Elm St')
    knockNotAVoter()

    await waitFor(() =>
      expect(
        screen.getByText('Not a voter — what happened?'),
      ).toBeInTheDocument(),
    )
    expect(
      screen.getByRole('heading', { name: 'Dorian Fen' }),
    ).toBeInTheDocument()
  })

  it('marks the resident and withholds the form once a reason is given', async () => {
    mockLiveRoute()

    render(<WalkHarness turfId={3} />)
    await openPersonSheet('105 Elm St')
    knockNotAVoter()
    await screen.findByText('Not a voter — what happened?')

    fireEvent.click(screen.getByRole('button', { name: 'Deceased' }))

    await waitFor(() => expect(screen.queryByText('Log this door')).toBeNull())
    expect(screen.getByText(/do not ask for them by name/)).toBeInTheDocument()

    // The marker has to survive walking on, so it patches the route cache the
    // way a recorded knock does.
    await closePersonSheet()
    const elmRow = screen.getAllByRole('listitem')[0] as HTMLElement
    expect(within(elmRow).getByText('Deceased')).toBeInTheDocument()
  })

  // A flagged resident is not a conversation anyone can have, so they leave the
  // denominator rather than holding a canvasser who correctly skipped them
  // below 100%.
  it('drops a flagged resident out of the progress counts', async () => {
    mockLiveRoute()

    render(<WalkHarness turfId={3} />)
    await waitFor(() =>
      expect(screen.getByText('1/2 logged')).toBeInTheDocument(),
    )

    await openPersonSheet('105 Elm St')
    knockNotAVoter()
    await screen.findByText('Not a voter — what happened?')
    fireEvent.click(screen.getByRole('button', { name: 'Moved' }))
    await screen.findByRole('button', { name: 'Undo' })
    await closePersonSheet()

    expect(screen.getByText('1/1 logged')).toBeInTheDocument()
    expect(
      screen.getByText(/Not a voter/, { selector: 'span' }),
    ).toHaveTextContent('Not a voter 0')
  })

  it('lifts the flag on undo, reflecting the cleared echo', async () => {
    api.mock('GET /v1/door-knocking/turfs/:id/route', {
      status: 200,
      data: {
        ...routePayload,
        stops: routePayload.stops.map((stop) =>
          stop.id !== 11
            ? stop
            : {
                ...stop,
                addresses: stop.addresses.map((address) => ({
                  ...address,
                  targets: address.targets.map((target) => ({
                    ...target,
                    notAVoterReason: 'moved' as const,
                  })),
                })),
              },
        ),
      },
    })
    api.mock('POST /v1/door-knocking/not-a-voter', {
      status: 200,
      data: { personId: 'person-1' },
    })

    render(<WalkHarness turfId={3} />)
    await waitFor(() =>
      expect(screen.getByText('105 Elm St')).toBeInTheDocument(),
    )
    // Only Marisol is knockable while Dorian is flagged.
    expect(screen.getByText('1/1 logged')).toBeInTheDocument()

    fireEvent.click(screen.getByText('105 Elm St'))
    await screen.findByRole('button', { name: 'Undo' })
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))

    // The form comes back only because the server said the flag is gone.
    await waitFor(() =>
      expect(screen.getByText('Log this door')).toBeInTheDocument(),
    )
    await closePersonSheet()
    expect(screen.getByText('1/2 logged')).toBeInTheDocument()
  })

  // The stop rolls up from an empty list of knockable residents, which is the
  // same grey as still-to-knock — so without a marker of its own a household
  // nobody can knock reads as an evening's work nobody has started.
  it('says a fully flagged household has nobody to knock', async () => {
    const base = routePayload.stops[0]!.addresses[0]!.targets[0]!
    api.mock('GET /v1/door-knocking/turfs/:id/route', {
      status: 200,
      data: {
        ...routePayload,
        stops: [
          {
            ...routePayload.stops[0]!,
            addresses: [
              {
                addressKey: '210|cedar|row',
                address: '210 Cedar Row',
                otherResidents: [],
                targets: [
                  { ...base, notAVoterReason: 'deceased' as const },
                  {
                    ...base,
                    stopTargetId: 23,
                    personId: 'person-3',
                    name: 'Ruben Vega',
                    notAVoterReason: 'moved' as const,
                  },
                ],
              },
            ],
          },
        ],
      },
    })

    render(<WalkHarness turfId={3} />)

    await waitFor(() =>
      expect(screen.getByText('210 Cedar Row')).toBeInTheDocument(),
    )
    const row = screen.getAllByRole('listitem')[0] as HTMLElement
    expect(within(row).getByText('Nobody to knock here')).toBeInTheDocument()
    // Both reasons are named once each — three deceased residents would still
    // be one thing to read.
    expect(within(row).getByText('Deceased')).toBeInTheDocument()
    expect(within(row).getByText('Moved away')).toBeInTheDocument()
    // No per-person dots, and no work left in the totals.
    expect(row.querySelectorAll('span.h-1\\.5')).toHaveLength(0)
    expect(screen.getByText('0/0 logged')).toBeInTheDocument()
    expect(
      within(screen.getByRole('group', { name: 'Outcomes so far' })).getByText(
        /Support unknown/,
        { selector: 'span' },
      ),
    ).toHaveTextContent('Support unknown 0')
  })

  // ADR 0009 left exactly one resident on a stale feed: this one, because their
  // sheet is deliberately held open across their own knock, so neither
  // `openSheet` nor the resident switcher ever fires for them. The refresh is
  // deferred rather than dropped — the three tests below are the two ways a
  // follow-up resolves, and the reason it could not simply fire on the knock.
  //
  // This one is that reason. `NotAVoterControl` switches branches on
  // `notAVoterReason`, so a serve arriving mid-answer replaces the question with
  // the marker under the canvasser's thumb. The second serve here carries a
  // reason a teammate set after this walk opened, which is what makes this an
  // assertion about the control rather than about a counter: had the refresh
  // fired, the question being answered would be gone.
  it('leaves the follow-up question standing rather than refreshing under it', async () => {
    let serves = 0
    api.mock('GET /v1/door-knocking/turfs/:id/route', () => {
      serves += 1
      return {
        status: 200,
        data: serveWithDorian(
          serves === 1
            ? {}
            : { knockStatus: 'not_a_voter', notAVoterReason: 'moved' },
        ),
      }
    })
    logNotAVoter()

    render(<WalkHarness turfId={3} />)
    await openPersonSheet('105 Elm St')
    knockNotAVoter()
    await screen.findByText('Not a voter — what happened?')

    // Read the screen only once a serve could have arrived. A refresh fired on
    // the knock would already be in flight here, so waiting for the query to be
    // idle again is what makes the assertions below see the swapped branch
    // rather than the frame before it.
    await waitFor(() =>
      expect(
        testQueryClient.getQueryState(['door-knocking-route', 3])?.fetchStatus,
      ).toBe('idle'),
    )
    expect(serves).toBe(1)
    // Both answers still offered, and the marker branch — its wording and its
    // Undo — nowhere on screen.
    expect(screen.getByRole('button', { name: 'Moved' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Deceased' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
    expect(screen.queryByText(/They stay off new lists/)).toBeNull()
  })

  // The follow-up is resolved, so the serve can land: the control is already the
  // marker that answer resolves to, and the row the refresh exists to fetch —
  // the flag's own status change — is the one thing in this sheet that only the
  // server can build.
  it('asks for the fresh feed once the follow-up is answered', async () => {
    const serves = mockLiveRoute()

    render(<WalkHarness turfId={3} />)
    await openPersonSheet('105 Elm St')
    knockNotAVoter()
    await screen.findByText('Not a voter — what happened?')
    expect(
      screen.getByText('No previous outreach to this resident.'),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Moved' }))

    await waitFor(() =>
      expect(screen.getByText('Not A Voter updated')).toBeInTheDocument(),
    )
    expect(screen.getByText(/Door Knock:/)).toBeInTheDocument()
    expect(serves()).toBe(2)
  })

  // The other way the question resolves: walked away from unanswered. The door
  // is logged either way, so its own feed is stale either way — and the sheet is
  // gone, so there is nothing left for the serve to arrive under. Asked for on
  // close rather than left to the next reopen so the serve is spent at the house
  // that still has signal, not at the next doorstep.
  it('asks for the fresh feed when the question is closed unanswered', async () => {
    const serves = mockLiveRoute()

    render(<WalkHarness turfId={3} />)
    await openPersonSheet('105 Elm St')
    knockNotAVoter()
    await screen.findByText('Not a voter — what happened?')
    expect(serves()).toBe(1)

    await closePersonSheet()

    await waitFor(() => expect(serves()).toBe(2))
    // The knock the serve was asked for is on the resident's feed on reopen,
    // with no second serve needed to put it there.
    fireEvent.click(screen.getByText('105 Elm St'))
    await waitFor(() =>
      expect(screen.getByText(/Door Knock:/)).toBeInTheDocument(),
    )
  })

  // Every other outcome auto-advances, so `openSheet` already covers it — and
  // paying a serve on every sheet close would be the per-door refresh ADR 0009
  // rejected, on the one connection the whole design exists to work without.
  it('does not re-serve the route when an ordinary door is closed on', async () => {
    let serves = 0
    api.mock('GET /v1/door-knocking/turfs/:id/route', () => {
      serves += 1
      return { status: 200, data: serveWithDorian({}) }
    })
    api.mock('POST /v1/door-knocking/interactions', {
      status: 200,
      data: { personId: 'person-1', knockStatus: 'not_home' },
    })

    render(<WalkHarness turfId={3} />)
    await openPersonSheet('105 Elm St')
    knockNotHome()
    // Nothing unlogged ahead, so this closes the sheet without going through
    // the close handler; reopening and closing by hand exercises that path.
    await waitFor(() => expect(screen.queryByText('Log this door')).toBeNull())

    fireEvent.click(screen.getByText('105 Elm St'))
    await waitFor(() => expect(serves).toBe(2))
    await closePersonSheet()

    expect(serves).toBe(2)
  })
})

// "Always show the next door so there is no thinking between houses." The
// fixture above ends with nothing unlogged ahead, so advancing needs its own.
describe('WalkView auto-advance', () => {
  const target = (
    stopTargetId: number,
    name: string,
    overrides: Partial<
      DoorKnockingRoutePayload['stops'][number]['addresses'][number]['targets'][number]
    > = {},
  ) => ({
    stopTargetId,
    personId: `person-${stopTargetId}`,
    name,
    age: 40,
    politicalParty: null,
    cellPhone: null,
    landline: null,
    knockStatus: 'unknown' as const,
    mayHaveMoved: false,
    doNotKnock: false,
    ...overrides,
  })

  const stop = (
    id: number,
    seq: number,
    address: string,
    targets: ReturnType<typeof target>[],
  ) => ({
    id,
    seq,
    lat: 36.16,
    lng: -86.78,
    displayAddress: address,
    legSeconds: 0,
    legMeters: 0,
    addresses: [
      {
        addressKey: address.toLowerCase().replaceAll(' ', '|'),
        address,
        targets,
        otherResidents: [],
      },
    ],
  })

  const payload = (
    stops: DoorKnockingRoutePayload['stops'],
  ): DoorKnockingRoutePayload => ({
    route: {
      id: 5,
      doorKnockingTurfId: 3,
      mode: 'walk',
      loop: false,
      totalSeconds: 600,
      totalMeters: 800,
      stopCount: stops.length,
      createdAt: new Date('2026-07-21T00:00:00Z'),
    },
    pathGeometry: null,
    stops,
  })

  const mockRoute = (stops: DoorKnockingRoutePayload['stops']) =>
    api.mock('GET /v1/door-knocking/turfs/:id/route', {
      status: 200,
      data: payload(stops),
    })

  const logNotHome = (personId: string) =>
    api.mock('POST /v1/door-knocking/interactions', {
      status: 200,
      data: { personId, knockStatus: 'not_home' },
    })

  beforeEach(() => {
    testQueryClient.clear()
    vi.mocked(trackEvent).mockClear()
  })

  // An apartment complex arrives as one stop with every unit's resident on it,
  // and each dot is `shrink-0`, so an uncapped row pushed through the card and
  // put a horizontal scrollbar on the whole page.
  it('caps the summary dots at a big stop and still names the real count', async () => {
    const residents = Array.from({ length: 40 }, (_, i) =>
      target(100 + i, `Resident ${i}`),
    )
    mockRoute([stop(11, 1, '375 Adriatic Pkwy Apt 1102', residents)])

    render(<WalkHarness turfId={3} />)
    await waitFor(() =>
      expect(
        screen.getByText('375 Adriatic Pkwy Apt 1102'),
      ).toBeInTheDocument(),
    )

    expect(stopRow(0).querySelectorAll('span.h-1\\.5')).toHaveLength(10)
    // The dots are decorative once a stop expands; this is the figure that is
    // not allowed to be a sample of anything.
    expect(stopRow(0)).toHaveTextContent('40 people')
  })

  it('opens the next unlogged door without a trip back to the list', async () => {
    mockRoute([
      stop(11, 1, '105 Elm St', [target(21, 'Dorian Fen')]),
      stop(12, 2, '210 Cedar Row', [target(22, 'Marisol Vega')]),
    ])
    logNotHome('person-21')

    render(<WalkHarness turfId={3} />)
    await openPersonSheet('105 Elm St')
    knockNotHome()

    // The sheet stays open on the next person rather than closing.
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Marisol Vega' }),
      ).toBeInTheDocument(),
    )
    expect(screen.getByText('Log this door')).toBeInTheDocument()
  })

  // The list's mark is the door the sheet is offering, not a history of taps —
  // so advancing has to move it, or a canvasser who closes the sheet after a
  // few doors is returned to a list pointing at the one they started on.
  it('moves the list’s mark onto the door it advances to', async () => {
    mockRoute([
      stop(11, 1, '105 Elm St', [target(21, 'Dorian Fen')]),
      stop(12, 2, '210 Cedar Row', [target(22, 'Marisol Vega')]),
    ])
    logNotHome('person-21')

    render(<WalkHarness turfId={3} />)
    await openPersonSheet('105 Elm St')
    expect(stopRow(0)).toHaveAttribute('aria-current', 'true')

    knockNotHome()

    await waitFor(() =>
      expect(stopRow(1)).toHaveAttribute('aria-current', 'true'),
    )
    expect(stopRow(0)).not.toHaveAttribute('aria-current')
  })

  // A door already logged earlier in the walk isn't worth stopping at again.
  it('skips a door that already has a status', async () => {
    mockRoute([
      stop(11, 1, '105 Elm St', [target(21, 'Dorian Fen')]),
      stop(12, 2, '210 Cedar Row', [
        target(22, 'Marisol Vega', { knockStatus: 'supporter' }),
      ]),
      stop(13, 3, '318 Birch Ave', [target(23, 'Ruben Cole')]),
    ])
    logNotHome('person-21')

    render(<WalkHarness turfId={3} />)
    await openPersonSheet('105 Elm St')
    knockNotHome()

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Ruben Cole' }),
      ).toBeInTheDocument(),
    )
  })

  // ADR 0007. A flagged door has nothing to log, so advancing onto it would
  // park the canvasser on a dead end.
  it('skips a do-not-knock door', async () => {
    mockRoute([
      stop(11, 1, '105 Elm St', [target(21, 'Dorian Fen')]),
      stop(12, 2, '210 Cedar Row', [
        target(22, 'Marisol Vega', { doNotKnock: true }),
      ]),
      stop(13, 3, '318 Birch Ave', [target(23, 'Ruben Cole')]),
    ])
    logNotHome('person-21')

    render(<WalkHarness turfId={3} />)
    await openPersonSheet('105 Elm St')
    knockNotHome()

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Ruben Cole' }),
      ).toBeInTheDocument(),
    )
  })

  // ADR 0008. Same dead end as a do-not-knock door: advancing onto a resident
  // who moved away parks the canvasser on a door with nothing to log.
  it('skips a resident flagged with a reason', async () => {
    mockRoute([
      stop(11, 1, '105 Elm St', [target(21, 'Dorian Fen')]),
      stop(12, 2, '210 Cedar Row', [
        target(22, 'Marisol Vega', { notAVoterReason: 'deceased' }),
      ]),
      stop(13, 3, '318 Birch Ave', [target(23, 'Ruben Cole')]),
    ])
    logNotHome('person-21')

    render(<WalkHarness turfId={3} />)
    await openPersonSheet('105 Elm St')
    knockNotHome()

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Ruben Cole' }),
      ).toBeInTheDocument(),
    )
  })

  // A household is several doors' worth of logging at one address, so the
  // next resident comes before the next stop.
  it('advances to the next resident of the same household first', async () => {
    mockRoute([
      stop(11, 1, '105 Elm St', [
        target(21, 'Dorian Fen'),
        target(24, 'Winnie Fen'),
      ]),
      stop(12, 2, '210 Cedar Row', [target(22, 'Marisol Vega')]),
    ])
    logNotHome('person-21')

    render(<WalkHarness turfId={3} />)
    // A multi-resident stop expands instead of opening, so the resident is
    // picked from the expansion.
    await waitFor(() =>
      expect(screen.getByText('105 Elm St')).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByText('105 Elm St'))
    // The name also labels the collapsed row, so the expansion's copy is the
    // later of the two.
    await waitFor(() =>
      expect(screen.getAllByText('Dorian Fen')).toHaveLength(2),
    )
    fireEvent.click(screen.getAllByText('Dorian Fen').pop()!)
    await waitFor(() =>
      expect(screen.getByText('Log this door')).toBeInTheDocument(),
    )

    knockNotHome()

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Winnie Fen' }),
      ).toBeInTheDocument(),
    )
  })

  // Aug 14 walkthrough: one household, one status per person — the canvasser
  // marks the resident who answered separately from the one who didn't. The
  // sheet stays open across the two, so the walkthrough has to be rebuilt for
  // the second rather than carrying the first one's answers into their record.
  it('starts the next resident on a blank walkthrough and logs them separately', async () => {
    mockRoute([
      stop(11, 1, '105 Elm St', [
        target(21, 'Dorian Fen'),
        target(24, 'Winnie Fen'),
      ]),
    ])
    const posted: unknown[] = []
    api.mock('POST /v1/door-knocking/interactions', ({ body }) => {
      posted.push(body)
      return {
        status: 200,
        data:
          posted.length === 1
            ? { personId: 'person-21', knockStatus: 'not_home' }
            : { personId: 'person-24', knockStatus: 'supporter' },
      }
    })

    render(<WalkHarness turfId={3} />)
    await waitFor(() =>
      expect(screen.getByText('105 Elm St')).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByText('105 Elm St'))
    await waitFor(() =>
      expect(screen.getAllByText('Dorian Fen')).toHaveLength(2),
    )
    fireEvent.click(screen.getAllByText('Dorian Fen').pop()!)
    await waitFor(() =>
      expect(screen.getByText('Log this door')).toBeInTheDocument(),
    )

    knockNotHome()

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Winnie Fen' }),
      ).toBeInTheDocument(),
    )
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    expect(
      within(
        screen.getByText('Did they answer?').parentElement as HTMLElement,
      ).getByRole('radio', { name: 'Not home' }),
    ).toHaveAttribute('data-state', 'off')

    answerQuestion('Did they answer?', 'Answered')
    answerQuestion('Did they engage?', 'Engaged')
    answerQuestion('Do they support you?', 'Yes')
    answerQuestion('Will they vote this election?', 'Yes')
    saveKnock()

    await waitFor(() => expect(posted).toHaveLength(2))
    expect(posted[0]).toMatchObject({ stopTargetId: 21, outcome: 'not_home' })
    expect(posted[1]).toMatchObject({
      stopTargetId: 24,
      outcome: 'answered',
      supportAnswer: 'supporter',
      willVote: 'yes',
    })
  })

  // Nothing ahead means the walk is done for this pass; anything skipped is
  // left on the list rather than dragging the canvasser back up the street.
  it('closes the sheet when the last door is logged', async () => {
    mockRoute([stop(11, 1, '105 Elm St', [target(21, 'Dorian Fen')])])
    logNotHome('person-21')

    render(<WalkHarness turfId={3} />)
    await openPersonSheet('105 Elm St')
    knockNotHome()

    await waitFor(() => expect(screen.queryByText('Log this door')).toBeNull())
  })

  // Each door needs its own replay key, so advancing has to mint for the
  // stop it lands on rather than reusing the one just cleared.
  // ADR 0009. The feed is served with the route, so the door just logged is
  // missing from it until the route is served again. Reopening the resident is
  // where that shows, and is therefore where the fresh serve is asked for.
  it('shows a door logged this walk in the feed when the resident is reopened', async () => {
    const stops = [stop(11, 1, '105 Elm St', [target(21, 'Dorian Fen')])]
    let serves = 0
    api.mock('GET /v1/door-knocking/turfs/:id/route', () => {
      serves += 1
      // The second serve is the one that has the knock, exactly as the server
      // builds it — the row is never assembled from the rollup on the client.
      return {
        status: 200,
        data:
          serves === 1
            ? payload(stops)
            : payload([
                stop(11, 1, '105 Elm St', [
                  target(21, 'Dorian Fen', {
                    knockStatus: 'not_home',
                    history: [
                      {
                        type: 'DOOR_KNOCK',
                        date: '2026-08-17T18:00:00.000Z',
                        data: {
                          activityId: 'dk-1',
                          outcome: 'not_home',
                          supportAnswer: null,
                          note: null,
                          manual: false,
                        },
                      },
                    ],
                  }),
                ]),
              ]),
      }
    })
    logNotHome('person-21')

    render(<WalkHarness turfId={3} />)
    await openPersonSheet('105 Elm St')
    expect(
      screen.getByText('No previous outreach to this resident.'),
    ).toBeInTheDocument()

    knockNotHome()
    // Nothing ahead, so the sheet closes on the logged door.
    await waitFor(() => expect(screen.queryByText('Log this door')).toBeNull())
    expect(serves).toBe(1)

    fireEvent.click(screen.getByText('105 Elm St'))
    await waitFor(() =>
      expect(screen.getByText(/Door Knock:/)).toBeInTheDocument(),
    )
    expect(serves).toBe(2)
  })

  // The cost is only paid where the staleness is visible: walking the list
  // forward never lands on a door already logged, so a whole route's worth of
  // doors costs the one serve the walk opened with.
  it('does not re-serve the route for a door it merely advances onto', async () => {
    let serves = 0
    api.mock('GET /v1/door-knocking/turfs/:id/route', () => {
      serves += 1
      return {
        status: 200,
        data: payload([
          stop(11, 1, '105 Elm St', [target(21, 'Dorian Fen')]),
          stop(12, 2, '210 Cedar Row', [target(22, 'Marisol Vega')]),
        ]),
      }
    })
    logNotHome('person-21')

    render(<WalkHarness turfId={3} />)
    await openPersonSheet('105 Elm St')
    knockNotHome()
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Marisol Vega' }),
      ).toBeInTheDocument(),
    )

    expect(serves).toBe(1)
  })

  // The knock is already saved by the time the refresh is asked for, so a
  // serve the walk can't reach must leave the walk exactly as it was. The old
  // banner fired on any error with data still in cache, which put "the route
  // could not load" beside a door that had just saved fine.
  it('keeps a logged door intact when the feed refresh fails', async () => {
    let serves = 0
    api.mock('GET /v1/door-knocking/turfs/:id/route', () => {
      serves += 1
      if (serves > 1) return { status: 500, data: {} }
      return {
        status: 200,
        data: payload([stop(11, 1, '105 Elm St', [target(21, 'Dorian Fen')])]),
      }
    })
    logNotHome('person-21')

    render(<WalkHarness turfId={3} />)
    await openPersonSheet('105 Elm St')
    knockNotHome()
    await waitFor(() => expect(screen.queryByText('Log this door')).toBeNull())
    expect(screen.getByText('1/1 logged')).toBeInTheDocument()

    fireEvent.click(screen.getByText('105 Elm St'))
    // The serve count is ofetch's business (it retries a 500 on its own), so
    // the settled query state is what says the refresh really did fail.
    await waitFor(() =>
      expect(
        testQueryClient.getQueryState(['door-knocking-route', 3])?.status,
      ).toBe('error'),
    )

    // No alarm, and the door stays logged on the payload already in hand.
    expect(screen.queryByText(/The route could not load/)).toBeNull()
    expect(screen.getByText('1/1 logged')).toBeInTheDocument()
    expect(
      screen.getByText('No previous outreach to this resident.'),
    ).toBeInTheDocument()
  })

  // A serve built before a knock lands after it and would put the door back to
  // unknown. It is cancelled by the patch, so the status the canvasser is
  // looking at is never walked backwards by a refresh they didn't ask for.
  it('does not let an in-flight serve undo a knock logged while it was open', async () => {
    const stops = [
      stop(11, 1, '105 Elm St', [target(21, 'Dorian Fen')]),
      stop(12, 2, '210 Cedar Row', [target(22, 'Marisol Vega')]),
    ]
    let serves = 0
    let releaseSecondServe: (() => void) | null = null
    api.mock('GET /v1/door-knocking/turfs/:id/route', async () => {
      serves += 1
      if (serves > 1) {
        await new Promise<void>((resolve) => {
          releaseSecondServe = resolve
        })
      }
      return { status: 200, data: payload(stops) }
    })
    api.mock('POST /v1/door-knocking/interactions', ({ body }) => ({
      status: 200,
      data: {
        personId:
          (body as { stopTargetId: number }).stopTargetId === 21
            ? 'person-21'
            : 'person-22',
        knockStatus: 'not_home',
      },
    }))

    render(<WalkHarness turfId={3} />)
    await openPersonSheet('105 Elm St')
    knockNotHome()
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Marisol Vega' }),
      ).toBeInTheDocument(),
    )

    // Back to the logged resident: that reopen starts the serve, which is
    // held open while the second door is logged.
    await closePersonSheet()
    fireEvent.click(screen.getByText('105 Elm St'))
    await waitFor(() => expect(serves).toBe(2))
    await closePersonSheet()

    fireEvent.click(screen.getByText('210 Cedar Row'))
    await waitFor(() =>
      expect(screen.getByText('Log this door')).toBeInTheDocument(),
    )
    knockNotHome()
    await waitFor(() => expect(screen.getByText('2/2 logged')).toBeTruthy())

    // The held serve carries neither knock; arriving now it must be discarded.
    releaseSecondServe!()
    await waitFor(() => expect(screen.getByText('2/2 logged')).toBeTruthy())
  })

  // The replay keys live in component state and the refreshed payload keys the
  // form by stopTargetId, so a serve arriving mid-walk must not remount the
  // form or lose the key a failed knock has to be retried under — that key is
  // the whole of what makes the retry upsert instead of duplicating.
  it('keeps a failed knock replayable across a feed refresh', async () => {
    let serves = 0
    api.mock('GET /v1/door-knocking/turfs/:id/route', () => {
      serves += 1
      return {
        status: 200,
        data: payload([
          stop(11, 1, '105 Elm St', [
            target(
              21,
              'Dorian Fen',
              serves === 1 ? {} : { knockStatus: 'not_home' },
            ),
            target(24, 'Winnie Fen'),
          ]),
        ]),
      }
    })
    const keys: string[] = []
    api.mock('POST /v1/door-knocking/interactions', ({ body }) => {
      const { stopTargetId, clientKey } = body as {
        stopTargetId: number
        clientKey: string
      }
      keys.push(`${stopTargetId}:${clientKey}`)
      if (stopTargetId === 24 && keys.length === 2) {
        return { status: 500, data: {} }
      }
      return {
        status: 200,
        data: { personId: `person-${stopTargetId}`, knockStatus: 'not_home' },
      }
    })

    render(<WalkHarness turfId={3} />)
    await waitFor(() =>
      expect(screen.getByText('105 Elm St')).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByText('105 Elm St'))
    await waitFor(() =>
      expect(screen.getAllByText('Dorian Fen')).toHaveLength(2),
    )
    fireEvent.click(screen.getAllByText('Dorian Fen').pop()!)
    await waitFor(() =>
      expect(screen.getByText('Log this door')).toBeInTheDocument(),
    )

    knockNotHome()
    // Advances to the housemate, whose knock then fails.
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Winnie Fen' }),
      ).toBeInTheDocument(),
    )
    knockNotHome()
    await waitFor(() => expect(screen.getByText(/Saving failed/)).toBeTruthy())

    // Back to the logged housemate, which is what asks for the fresh serve,
    // and then forward again to retry the door that failed.
    fireEvent.click(screen.getByRole('button', { name: 'Dorian Fen' }))
    await waitFor(() => expect(serves).toBe(2))
    fireEvent.click(screen.getByRole('button', { name: 'Winnie Fen' }))
    await waitFor(() =>
      expect(screen.getByText('Log this door')).toBeInTheDocument(),
    )
    knockNotHome()

    await waitFor(() => expect(keys).toHaveLength(3))
    expect(keys[2]).toBe(keys[1])
  })

  it('gives the door it advances to a distinct clientKey', async () => {
    const keys: string[] = []
    mockRoute([
      stop(11, 1, '105 Elm St', [target(21, 'Dorian Fen')]),
      stop(12, 2, '210 Cedar Row', [target(22, 'Marisol Vega')]),
    ])
    api.mock('POST /v1/door-knocking/interactions', ({ body }) => {
      keys.push((body as { clientKey: string }).clientKey)
      return {
        status: 200,
        data: { personId: 'person-21', knockStatus: 'not_home' },
      }
    })

    render(<WalkHarness turfId={3} />)
    await openPersonSheet('105 Elm St')
    knockNotHome()
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Marisol Vega' }),
      ).toBeInTheDocument(),
    )

    knockNotHome()
    await waitFor(() => expect(keys).toHaveLength(2))
    expect(keys[1]).toMatch(/[0-9a-f-]{36}/)
    expect(keys[1]).not.toBe(keys[0])
  })
})

// The numeral rides the stop's status fill, which is seven fixed colors from
// yellow to black — one numeral color cannot be legible on all of them, and the
// two the walk list can choose between are white and black. This asserts the
// rule picks a readable one for every status rather than the palette happening
// to suit whichever was hardcoded.
describe('WalkView stop numerals', () => {
  const channel = (value: number): number => {
    const scaled = value / 255
    return scaled <= 0.03928
      ? scaled / 12.92
      : ((scaled + 0.055) / 1.055) ** 2.4
  }
  const luminance = ([red, green, blue]: [number, number, number]): number =>
    0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)
  const contrast = (
    numeral: string,
    fill: [number, number, number],
  ): number => {
    const numeralLuminance = numeral === '#ffffff' ? 1 : 0
    const [lighter, darker] = [
      Math.max(numeralLuminance, luminance(fill)),
      Math.min(numeralLuminance, luminance(fill)),
    ]
    return ((lighter as number) + 0.05) / ((darker as number) + 0.05)
  }

  it('stays legible on every status color', () => {
    for (const [status, rgb] of Object.entries(STATUS_RGB)) {
      expect(
        contrast(
          stopNumeralColor(status as keyof typeof STATUS_RGB),
          rgb as [number, number, number],
        ),
      ).toBeGreaterThanOrEqual(4.5)
    }
  })
})

// A pin is what a canvasser is actually standing in front of, so tapping one
// has to reach the same PersonSheet a stop row reaches. The page owns the map
// and turns a tap into this request; the view turns it into an open door.
describe('WalkView map pin taps', () => {
  const target = (
    stopTargetId: number,
    name: string,
    overrides: Partial<RoutePayloadTarget> = {},
  ): RoutePayloadTarget => ({
    stopTargetId,
    personId: `person-${stopTargetId}`,
    name,
    age: 40,
    politicalParty: null,
    cellPhone: null,
    landline: null,
    knockStatus: 'unknown',
    mayHaveMoved: false,
    doNotKnock: false,
    ...overrides,
  })

  const stop = (
    id: number,
    seq: number,
    address: string,
    targets: RoutePayloadTarget[],
  ) => ({
    id,
    seq,
    lat: 36.16,
    lng: -86.78,
    displayAddress: address,
    legSeconds: 0,
    legMeters: 0,
    addresses: [
      {
        addressKey: address.toLowerCase().replaceAll(' ', '|'),
        address,
        targets,
        otherResidents: [],
      },
    ],
  })

  const mockRoute = (stops: DoorKnockingRoutePayload['stops']) =>
    api.mock('GET /v1/door-knocking/turfs/:id/route', {
      status: 200,
      data: {
        route: {
          id: 5,
          doorKnockingTurfId: 3,
          mode: 'walk' as const,
          loop: false,
          totalSeconds: 600,
          totalMeters: 800,
          stopCount: stops.length,
          createdAt: new Date('2026-07-21T00:00:00Z'),
        },
        pathGeometry: null,
        stops,
      },
    })

  // Pins only exist once the serve has landed, so a walk always renders before
  // the first tap can happen.
  const walkThenTap = async (
    stops: DoorKnockingRoutePayload['stops'],
    request: { stopId: number; token: number },
  ) => {
    mockRoute(stops)
    const { rerender } = render(<WalkHarness turfId={3} />)
    await waitFor(() =>
      expect(screen.getByText('105 Elm St')).toBeInTheDocument(),
    )
    rerender(<WalkHarness turfId={3} openStopRequest={request} />)
    return rerender
  }

  beforeEach(() => {
    testQueryClient.clear()
    vi.mocked(trackEvent).mockClear()
  })

  it('opens the tapped stop’s door', async () => {
    await walkThenTap(
      [
        stop(11, 1, '105 Elm St', [target(21, 'Dorian Fen')]),
        stop(12, 2, '210 Cedar Row', [target(22, 'Marisol Vega')]),
      ],
      { stopId: 12, token: 1 },
    )

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Marisol Vega' }),
      ).toBeInTheDocument(),
    )
    expect(screen.getByText('Log this door')).toBeInTheDocument()
  })

  // The other half of the map's selection: the list follows the pin. The map
  // band and the list are stacked, so the tapped stop's row is usually scrolled
  // off screen — closing the sheet would otherwise leave a canvasser looking at
  // some other part of the street, with the numbered pin they tapped nowhere in
  // view.
  it('brings the list to the stop whose pin was tapped', async () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView')
    try {
      await walkThenTap(
        [
          stop(11, 1, '105 Elm St', [target(21, 'Dorian Fen')]),
          stop(12, 2, '210 Cedar Row', [target(22, 'Marisol Vega')]),
        ],
        { stopId: 12, token: 1 },
      )

      await waitFor(() =>
        expect(stopRow(1)).toHaveAttribute('aria-current', 'true'),
      )
      expect(stopRow(0)).not.toHaveAttribute('aria-current')
      expect(scrollIntoView).toHaveBeenCalled()
    } finally {
      scrollIntoView.mockRestore()
    }
  })

  // The row expands for a household so the canvasser can pick; a pin has no
  // list under it to expand into, and the sheet's own switcher is that picker.
  it('opens a household at the first resident still worth knocking', async () => {
    await walkThenTap(
      [
        stop(11, 1, '105 Elm St', [
          target(21, 'Dorian Fen', { doNotKnock: true }),
          target(24, 'Winnie Fen'),
        ]),
      ],
      { stopId: 11, token: 1 },
    )

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Winnie Fen' }),
      ).toBeInTheDocument(),
    )
    expect(screen.getByText('Log this door')).toBeInTheDocument()
  })

  // A hollow pin has nobody left to knock. Opening it anyway is the point: the
  // sheet withholds the script and the form and renders the flag's own control
  // instead, so the tap answers "why am I skipping this house?" from the
  // doorstep — where a flag set on the wrong resident is caught — rather than
  // going dead under the thumb, which is the bug being fixed.
  it('opens a stop with nobody knockable without offering a knock', async () => {
    await walkThenTap(
      [
        stop(11, 1, '105 Elm St', [
          target(21, 'Dorian Fen', { doNotKnock: true }),
        ]),
      ],
      { stopId: 11, token: 1 },
    )

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Dorian Fen' }),
      ).toBeInTheDocument(),
    )
    expect(screen.queryByText('Log this door')).toBeNull()
    expect(
      screen.getByText(/asked not to be visited again/),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()
  })

  // Closing the sheet leaves the page's tapped-pin state alone, so a bare stop
  // id would be inert the second time — the token is what makes the same pin
  // openable again.
  it('reopens the same stop when its pin is tapped again', async () => {
    const rerender = await walkThenTap(
      [stop(11, 1, '105 Elm St', [target(21, 'Dorian Fen')])],
      { stopId: 11, token: 1 },
    )
    await waitFor(() =>
      expect(screen.getByText('Log this door')).toBeInTheDocument(),
    )
    await closePersonSheet()

    rerender(
      <WalkHarness turfId={3} openStopRequest={{ stopId: 11, token: 2 }} />,
    )

    await waitFor(() =>
      expect(screen.getByText('Log this door')).toBeInTheDocument(),
    )
  })

  // Every knock patches the route cache, which rebuilds the stops the effect
  // reads — a reopen on each one would spring the sheet back up on a canvasser
  // who had closed it.
  it('does not reopen the sheet when a knock patches the route', async () => {
    api.mock('POST /v1/door-knocking/interactions', {
      status: 200,
      data: { personId: 'person-21', knockStatus: 'not_home' },
    })
    await walkThenTap([stop(11, 1, '105 Elm St', [target(21, 'Dorian Fen')])], {
      stopId: 11,
      token: 1,
    })
    await waitFor(() =>
      expect(screen.getByText('Log this door')).toBeInTheDocument(),
    )

    // Nothing left ahead, so logging this door closes the sheet — and it has
    // to stay closed.
    knockNotHome()
    await waitFor(() => expect(screen.queryByText('Log this door')).toBeNull())

    expect(screen.queryByText('Log this door')).toBeNull()
  })

  // The canvas's panel header navigates the route door by door
  // (`navBtn('chevron-left', ()=>this.openPanel(route[idx-1].id), hasPrev)`);
  // ours had no equivalent, so the only way to the next house was to close the
  // sheet and find the row. Both chevrons go through the same open path a pin
  // tap does, so the list follows and the mark moves with them.
  it('walks to the next and previous door from the sheet', async () => {
    await walkThenTap(
      [
        stop(11, 1, '105 Elm St', [target(21, 'Dorian Fen')]),
        stop(12, 2, '210 Cedar Row', [target(22, 'Marisol Vega')]),
      ],
      { stopId: 11, token: 1 },
    )
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Dorian Fen' }),
      ).toBeInTheDocument(),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Next door' }))

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Marisol Vega' }),
      ).toBeInTheDocument(),
    )
    // The mark moved with it: the sheet and the list are showing one door.
    expect(stopRow(1)).toHaveAttribute('aria-current', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Previous door' }))

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Dorian Fen' }),
      ).toBeInTheDocument(),
    )
    expect(stopRow(0)).toHaveAttribute('aria-current', 'true')
  })

  // Disabled at the ends rather than absent: a chevron that disappears at the
  // last door is indistinguishable from one that broke, and the pair keeps its
  // place in the header instead of reflowing it as the canvasser walks.
  it('disables the chevrons at the ends of the route', async () => {
    await walkThenTap(
      [
        stop(11, 1, '105 Elm St', [target(21, 'Dorian Fen')]),
        stop(12, 2, '210 Cedar Row', [target(22, 'Marisol Vega')]),
      ],
      { stopId: 11, token: 1 },
    )
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Dorian Fen' }),
      ).toBeInTheDocument(),
    )

    expect(screen.getByRole('button', { name: 'Previous door' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next door' })).not.toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Next door' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Next door' })).toBeDisabled(),
    )
    expect(
      screen.getByRole('button', { name: 'Previous door' }),
    ).not.toBeDisabled()
  })

  // The canvas draws all three header controls as plain glyphs. Ours took the
  // IconButton default, which is a filled primary circle — so a panel about a
  // person led with three blue discs around their name. The hit target is the
  // same either way, which is the half that matters at a doorstep.
  it('draws the panel’s header controls as glyphs, not filled circles', async () => {
    await walkThenTap(
      [
        stop(11, 1, '105 Elm St', [target(21, 'Dorian Fen')]),
        stop(12, 2, '210 Cedar Row', [target(22, 'Marisol Vega')]),
      ],
      { stopId: 11, token: 1 },
    )
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Dorian Fen' }),
      ).toBeInTheDocument(),
    )

    for (const name of ['Previous door', 'Next door', 'Close person details']) {
      const control = screen.getAllByRole('button', { name }).pop()!
      expect(control.className).not.toContain('bg-primary')
      expect(control.className).toContain('bg-transparent')
      // Still a target and not a text link: the size class is the button's.
      expect(control.className).toMatch(/size-\d+/)
    }
  })

  // Same numeral the row and the pin carry — `seq`, never a position in a list,
  // so the sheet cannot become a third name for one stop. The seqs here are 3
  // and 7 for exactly that reason: with 1 and 2 an off-by-nothing index bug
  // would agree with the right answer and the test would pass on a wrong build.
  it('names the stop by its route number in the sheet header', async () => {
    await walkThenTap(
      [
        stop(11, 3, '105 Elm St', [target(21, 'Dorian Fen')]),
        stop(12, 7, '210 Cedar Row', [target(22, 'Marisol Vega')]),
      ],
      { stopId: 12, token: 1 },
    )

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Marisol Vega' }),
      ).toBeInTheDocument(),
    )
    // Every numbered badge on the page, read the way a screen reader gets it:
    // the sr-only "Stop " prefix plus the numeral beside it. Two rows and then
    // the sheet, which is the one under test — and the numbers are what a
    // position-based bug would get wrong, printing 1, 2, 2 here.
    expect(
      screen
        .getAllByText('Stop', { selector: 'span.sr-only' })
        .map((label) => label.parentElement?.textContent?.trim()),
    ).toEqual(['Stop 3', 'Stop 7', 'Stop 7'])
  })

  // The chevrons move the sheet between doors without unmounting it, so the
  // scrolling body keeps its offset — a canvasser who read the activity feed at
  // one house would arrive at the next already past the address and the phones.
  it('returns the sheet to the top of the next door', async () => {
    await walkThenTap(
      [
        stop(11, 1, '105 Elm St', [target(21, 'Dorian Fen')]),
        stop(12, 2, '210 Cedar Row', [target(22, 'Marisol Vega')]),
      ],
      { stopId: 11, token: 1 },
    )
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Dorian Fen' }),
      ).toBeInTheDocument(),
    )
    // The card headers are inside the scrolling body, so this finds it without
    // reaching for a class name.
    const body = screen
      .getByText('Contact information')
      .closest('div.overflow-y-auto') as HTMLElement
    body.scrollTop = 420

    fireEvent.click(screen.getByRole('button', { name: 'Next door' }))

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Marisol Vega' }),
      ).toBeInTheDocument(),
    )
    expect(
      (
        screen
          .getByText('Contact information')
          .closest('div.overflow-y-auto') as HTMLElement
      ).scrollTop,
    ).toBe(0)
  })
})

// ADR 0011. The card's own reads and writes are DoorNotesCard.test.tsx's and
// the list algebra is doorNotes.test.ts's; what belongs here is the one thing
// only the walk can hold — that a note written at a door outlives the sheet it
// was written in, because it goes into the cached route payload rather than
// into state that dies with the sheet.
describe('WalkView notes', () => {
  const target = (
    stopTargetId: number,
    name: string,
    overrides: Partial<RoutePayloadTarget> = {},
  ): RoutePayloadTarget => ({
    stopTargetId,
    personId: `person-${stopTargetId}`,
    name,
    age: 40,
    politicalParty: null,
    cellPhone: null,
    landline: null,
    knockStatus: 'unknown',
    mayHaveMoved: false,
    doNotKnock: false,
    ...overrides,
  })

  const stop = (
    id: number,
    seq: number,
    address: string,
    targets: RoutePayloadTarget[],
  ) => ({
    id,
    seq,
    lat: 36.16,
    lng: -86.78,
    displayAddress: address,
    legSeconds: 0,
    legMeters: 0,
    addresses: [
      {
        addressKey: address.toLowerCase().replaceAll(' ', '|'),
        address,
        targets,
        otherResidents: [],
      },
    ],
  })

  const mockRoute = (
    stops: DoorKnockingRoutePayload['stops'],
    onServe?: () => void,
  ) =>
    api.mock('GET /v1/door-knocking/turfs/:id/route', () => {
      onServe?.()
      return {
        status: 200,
        data: {
          route: {
            id: 5,
            doorKnockingTurfId: 3,
            mode: 'walk' as const,
            loop: false,
            totalSeconds: 600,
            totalMeters: 800,
            stopCount: stops.length,
            createdAt: new Date('2026-07-21T00:00:00Z'),
          },
          pathGeometry: null,
          stops,
        },
      }
    })

  const savedNote = () =>
    api.mock('POST /v1/contacts/:personId/notes', ({ params, body }) => ({
      status: 200,
      data: {
        id: 'note-new',
        personId: params.personId,
        body: body.body,
        createdAt: '2026-08-24T18:00:00.000Z',
        updatedAt: '2026-08-24T18:00:00.000Z',
        actorName: null,
      },
    }))

  const served = (body: string, id = 'note-1') => ({
    id,
    personId: 'person-21',
    body,
    createdAt: '2026-07-01T15:00:00.000Z',
    updatedAt: '2026-07-01T15:00:00.000Z',
    actorName: null,
  })

  // The stop list is a list of listitems too, so a note row can only be counted
  // from inside the card.
  const notesCard = () =>
    screen.getByRole('heading', { name: 'Notes' }).parentElement!

  const writeNote = async (body: string) => {
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Add a note' }))
    await user.type(screen.getByLabelText('Add a note'), body)
    await user.click(screen.getByRole('button', { name: 'Save note' }))
    await waitFor(() => expect(screen.getByText(body)).toBeInTheDocument())
  }

  beforeEach(() => {
    testQueryClient.clear()
    vi.mocked(trackEvent).mockClear()
  })

  // The defect this whole path closes, in the shape a canvasser meets it: a
  // note is the one thing worth writing at a door nobody answered, and a door
  // nobody answered is often shut without being logged — the canvasser writes
  // "come back Saturday", closes the sheet and walks on. Nothing then refreshes
  // that resident (`openSheet`'s ADR 0009 serve is for residents logged this
  // session, and this one was not), so a sheet re-seeded from the frozen
  // payload showed a note that had definitely saved as though it had not.
  it('keeps a note written at a door that was closed without being logged', async () => {
    mockRoute([stop(11, 1, '105 Elm St', [target(21, 'Dorian Fen')])])
    savedNote()

    render(<WalkHarness turfId={3} />)
    await openPersonSheet('105 Elm St')
    await writeNote('Come back Saturday')

    await closePersonSheet()
    fireEvent.click(screen.getByText('105 Elm St'))
    await waitFor(() =>
      expect(screen.getByText('Log this door')).toBeInTheDocument(),
    )

    expect(screen.getByText('Come back Saturday')).toBeInTheDocument()
  })

  // The count has to travel with the rows or the card starts lying in the
  // direction that sends someone to Contacts for notes that are not there. A
  // resident at the cap deleting one leaves two of eight — and it is still two
  // of eight when the door is opened again, not the served three of nine.
  it('keeps a deleted note deleted, and its count honest, across a reopen', async () => {
    const user = userEvent.setup()
    mockRoute([
      stop(11, 1, '105 Elm St', [
        target(21, 'Dorian Fen', {
          notes: {
            entries: [
              served('Dog in the front yard'),
              served('Works nights', 'note-2'),
              served('Side gate is unlocked', 'note-3'),
            ],
            total: 9,
          },
        }),
      ]),
    ])
    api.mock('DELETE /v1/contacts/notes/:noteId', { status: 200, data: {} })

    render(<WalkHarness turfId={3} />)
    await openPersonSheet('105 Elm St')
    expect(
      screen.getByText(/Showing the 3 most recent of 9/),
    ).toBeInTheDocument()

    await user.click(
      screen
        .getAllByRole('button', { name: /^Delete note from/ })
        .at(1) as HTMLElement,
    )
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.queryByText('Works nights')).toBeNull())

    await closePersonSheet()
    fireEvent.click(screen.getByText('105 Elm St'))
    await waitFor(() =>
      expect(screen.getByText('Log this door')).toBeInTheDocument(),
    )

    expect(screen.queryByText('Works nights')).toBeNull()
    expect(
      screen.getByText(/Showing the 2 most recent of 8/),
    ).toBeInTheDocument()
  })

  // The two rules #1406 argued for, asserted where they now live — on the
  // payload rather than on a list held beside it, since that is the copy a
  // reopened sheet reads. A fourth note is not evicted to imitate a wire cap
  // that prices payload bytes a note in this browser does not cost, and an
  // edit is replaced in place rather than floated to the top, because ADR 0011
  // orders by `created_at` so that fixing a typo in an old note does not
  // resurface it above one written this morning.
  it('does not trim to the cap, and does not resurface an edited note', async () => {
    const user = userEvent.setup()
    mockRoute([
      stop(11, 1, '105 Elm St', [
        target(21, 'Dorian Fen', {
          notes: {
            entries: [
              served('Newest served note'),
              served('Middle served note', 'note-2'),
              served('Oldest served note', 'note-3'),
            ],
            total: 3,
          },
        }),
      ]),
    ])
    savedNote()
    api.mock('PATCH /v1/contacts/notes/:noteId', ({ params, body }) => ({
      status: 200,
      data: {
        ...served(body.body, params.noteId),
        updatedAt: '2026-08-24T19:00:00.000Z',
      },
    }))

    render(<WalkHarness turfId={3} />)
    await openPersonSheet('105 Elm St')
    await writeNote('Written at the door')

    // The last row is the oldest note, which is the one an in-place replace has
    // to leave exactly where it is.
    await user.click(
      screen
        .getAllByRole('button', { name: /^Edit note from/ })
        .at(-1) as HTMLElement,
    )
    await user.clear(screen.getByLabelText('Edit note'))
    await user.type(screen.getByLabelText('Edit note'), 'Oldest, corrected')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(screen.getByText('Oldest, corrected')).toBeInTheDocument(),
    )

    await closePersonSheet()
    fireEvent.click(screen.getByText('105 Elm St'))
    await waitFor(() =>
      expect(screen.getByText('Log this door')).toBeInTheDocument(),
    )

    const bodies = within(notesCard())
      .getAllByRole('listitem')
      .map((row) => row.textContent ?? '')
    // Four rows, not three: the cap was never applied to a note already here.
    expect(bodies).toHaveLength(4)
    expect(bodies[0]).toContain('Written at the door')
    expect(bodies[1]).toContain('Newest served note')
    expect(bodies[2]).toContain('Middle served note')
    // Still last, though it is the note most recently touched: ADR 0011 orders
    // by when a note was written, not by when it was edited.
    expect(bodies[3]).toContain('Oldest, corrected')
    // Four of four, so the card claims no truncation it does not have.
    expect(screen.queryByText(/Showing the/)).toBeNull()
  })

  // The same race `patchPerson` cancels for a knock, met by a note: the ADR
  // 0009 feed refresh for this resident is already in flight when the note is
  // written, and it was built by a server that had never seen it. Landing
  // afterwards it would take the note back off a card the canvasser had just
  // watched save.
  it('does not let an in-flight serve undo a note written while it was open', async () => {
    let releaseSecondServe: (() => void) | null = null
    let serves = 0
    api.mock('GET /v1/door-knocking/turfs/:id/route', async () => {
      serves += 1
      if (serves > 1) {
        await new Promise<void>((resolve) => {
          releaseSecondServe = resolve
        })
      }
      return {
        status: 200,
        data: {
          route: {
            id: 5,
            doorKnockingTurfId: 3,
            mode: 'walk' as const,
            loop: false,
            totalSeconds: 600,
            totalMeters: 800,
            stopCount: 1,
            createdAt: new Date('2026-07-21T00:00:00Z'),
          },
          pathGeometry: null,
          stops: [
            stop(11, 1, '105 Elm St', [
              target(21, 'Dorian Fen', {
                knockStatus: serves === 1 ? 'unknown' : 'not_home',
                notes: { entries: [], total: 0 },
              }),
            ]),
          ],
        },
      }
    })
    api.mock('POST /v1/door-knocking/interactions', {
      status: 200,
      data: { personId: 'person-21', knockStatus: 'not_home' },
    })
    savedNote()

    render(<WalkHarness turfId={3} />)
    await openPersonSheet('105 Elm St')
    knockNotHome()
    // Nothing ahead, so the door closes on itself; reopening a resident logged
    // this session is what asks for the serve that is then held open.
    await waitFor(() => expect(screen.queryByText('Log this door')).toBeNull())
    fireEvent.click(screen.getByText('105 Elm St'))
    await waitFor(() => expect(serves).toBe(2))

    await writeNote('Come back Saturday')

    // Settled, not slept on, the way the ADR 0008 refresh test above reads its
    // failed serve: the patch's cancellation puts this query idle immediately,
    // so nothing lands and the note stays — while with the cancellation removed
    // the query is still fetching here, and reaching idle means the serve has
    // arrived and taken the note back off the card. A wall-clock wait would
    // pass either way on a slow enough runner.
    releaseSecondServe!()
    await waitFor(() =>
      expect(
        testQueryClient.getQueryState(['door-knocking-route', 3])?.fetchStatus,
      ).toBe('idle'),
    )

    expect(screen.getByText('Come back Saturday')).toBeInTheDocument()
  })
})
