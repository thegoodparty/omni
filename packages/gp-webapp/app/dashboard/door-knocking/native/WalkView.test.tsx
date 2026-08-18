import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import {
  DoorKnockingRoutePayload,
  NotAVoterReason,
  RoutePayloadTarget,
  RouteTargetActivity,
} from '@goodparty_org/contracts'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import WalkView from './WalkView'
import { STATUS_DOT_COLORS } from './statusPresentation'

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
      knockStatus: 'supporter',
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
      knockStatus: 'unknown',
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

// The cascade (outcome, then support, then will-vote, then a note) now sits
// behind a disclosure; the sheet opens on the one-tap chips instead.
const openDetailForm = () =>
  fireEvent.click(
    screen.getByRole('button', { name: 'Add a note or more detail' }),
  )

const closePersonSheet = async () => {
  fireEvent.click(
    screen.getAllByRole('button', { name: 'Close person details' }).pop()!,
  )
  await waitFor(() => expect(screen.queryByText('Log this door')).toBeNull())
}

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
    render(<WalkView turfId={3} />)

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

  // Aug 14 walkthrough: the list view shows housing information, not step
  // numbers. Ordering stays where it's actually walked — the map pins and the
  // printed sheet — while the circle keeps carrying the stop's status color.
  it('renders each stop as a status circle with no sequence number', async () => {
    render(<WalkView turfId={3} />)

    await waitFor(() =>
      expect(screen.getByText('105 Elm St')).toBeInTheDocument(),
    )
    const rows = screen.getAllByRole('listitem')

    const elmDot = (rows[0] as HTMLElement).querySelector('span.h-7')
    expect(elmDot).toHaveTextContent('')
    expect(elmDot).toHaveStyle({ backgroundColor: STATUS_DOT_COLORS.unknown })
    const cedarDot = (rows[1] as HTMLElement).querySelector('span.h-7')
    expect(cedarDot).toHaveTextContent('')
    expect(cedarDot).toHaveStyle({
      backgroundColor: STATUS_DOT_COLORS.supporter,
    })

    // The seq numeral lived inside the colored circle, so a colored element
    // carrying a digit anywhere in either row means it came back.
    for (const row of rows) {
      const numbered = Array.from(
        (row as HTMLElement).querySelectorAll<HTMLElement>('span[style]'),
      ).filter(
        (element) =>
          element.style.backgroundColor && /\d/.test(element.textContent ?? ''),
      )
      expect(numbered).toHaveLength(0)
    }
  })

  // The offline story: paper is reached from the walk, and the sheet has to
  // open in its own tab so the walk in progress isn't navigated away from.
  it('links out to the printable list for this turf', async () => {
    render(<WalkView turfId={3} />)

    const link = await screen.findByRole('link', { name: 'Print list' })
    expect(link).toHaveAttribute('href', '/dashboard/door-knocking/print/3')
    expect(link).toHaveAttribute('target', '_blank')
  })

  // ADR 0007. The marker has to survive walking on to the next stop, so it
  // patches the route cache the way a recorded knock does.
  it('marks a flagged door in the list and withholds the log form', async () => {
    api.mock('POST /v1/door-knocking/do-not-knock', {
      status: 200,
      data: { personId: 'person-1', doNotKnock: true },
    })

    render(<WalkView turfId={3} />)
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

    // The label is a bare text node beside its count, so the chip itself is the
    // only span whose text carries both.
    const unknownChip = () =>
      screen.getByText(/Support unknown/, { selector: 'span' })

    render(<WalkView turfId={3} />)
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

    render(<WalkView turfId={3} />)

    await waitFor(() =>
      expect(screen.getByText('210 Cedar Row')).toBeInTheDocument(),
    )
    const row = screen.getAllByRole('listitem')[0] as HTMLElement
    // The stop's own circle, the one the rollup colors — no longer identifiable
    // by a sequence number, since the list view doesn't print one.
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

    render(<WalkView turfId={3} />)
    await openPersonSheet('105 Elm St')
    expect(
      screen.getByText('May have moved since this route was built.'),
    ).toBeInTheDocument()

    openDetailForm()
    fireEvent.click(screen.getByRole('radio', { name: 'Answered' }))
    fireEvent.click(
      within(
        screen.getByText('Do they support you?').parentElement as HTMLElement,
      ).getByRole('radio', { name: 'Yes' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save knock' }))

    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toMatchObject({
      stopTargetId: 21,
      outcome: 'answered',
      supportAnswer: 'supporter',
    })
    expect((posted[0] as { clientKey: string }).clientKey).toMatch(
      /[0-9a-f-]{36}/,
    )
    expect(posted[0]).not.toHaveProperty('willVote')

    // Sheet closes and the logged counter reflects the new status.
    await waitFor(() => expect(screen.queryByText('Log this door')).toBeNull())
    expect(screen.getByText('2/2 logged')).toBeInTheDocument()

    expect(trackEvent).toHaveBeenCalledWith(EVENTS.DoorKnocking.DoorLogged, {
      outcome: 'answered',
      supportAnswer: 'supporter',
      knockStatus: 'supporter',
      hasNote: false,
      logMode: 'detail',
    })
  })

  // The note is free text about a named voter, so only its existence travels.
  it('reports that a note was written without shipping what it said', async () => {
    api.mock('POST /v1/door-knocking/interactions', {
      status: 200,
      data: { personId: 'person-1', knockStatus: 'not_home' },
    })

    render(<WalkView turfId={3} />)
    await openPersonSheet('105 Elm St')
    openDetailForm()
    fireEvent.click(screen.getByRole('radio', { name: 'Not home' }))
    fireEvent.change(screen.getByPlaceholderText('Notes (optional)'), {
      target: { value: 'Dog in the yard, come back Saturday' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save knock' }))

    await waitFor(() =>
      expect(trackEvent).toHaveBeenCalledWith(EVENTS.DoorKnocking.DoorLogged, {
        outcome: 'not_home',
        knockStatus: 'not_home',
        hasNote: true,
        logMode: 'detail',
      }),
    )
    const logged = vi
      .mocked(trackEvent)
      .mock.calls.find(([name]) => name === EVENTS.DoorKnocking.DoorLogged)
    expect(JSON.stringify(logged?.[1])).not.toContain('Dog in the yard')
  })

  it('does not report a door the server refused', async () => {
    api.mock('POST /v1/door-knocking/interactions', { status: 500, data: {} })

    render(<WalkView turfId={3} />)
    await openPersonSheet('105 Elm St')
    fireEvent.click(screen.getByRole('button', { name: 'Not home' }))

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

    render(<WalkView turfId={3} />)
    await openPersonSheet('105 Elm St')
    fireEvent.click(screen.getByRole('button', { name: 'Not home' }))
    await waitFor(() => expect(keys).toHaveLength(1))

    // Close and reopen the sheet — the remount must not mint a new key,
    // or the server-side upsert can't dedupe the retry.
    await closePersonSheet()
    await openPersonSheet('105 Elm St')
    fireEvent.click(screen.getByRole('button', { name: 'Not home' }))
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

    render(<WalkView turfId={3} />)
    await openPersonSheet('105 Elm St')
    fireEvent.click(screen.getByRole('button', { name: 'Not home' }))
    await waitFor(() => expect(keys).toHaveLength(1))
    await waitFor(() => expect(screen.queryByText('Log this door')).toBeNull())

    await openPersonSheet('105 Elm St')
    fireEvent.click(screen.getByRole('button', { name: 'Not home' }))
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

    render(<WalkView turfId={3} />)
    await openPersonSheet('105 Elm St')
    openDetailForm()
    // Pick answers first, then flip to Not home — the answers must not leak.
    fireEvent.click(screen.getByRole('radio', { name: 'Answered' }))
    fireEvent.click(
      within(
        screen.getByText('Will they vote?').parentElement as HTMLElement,
      ).getByRole('radio', { name: 'Yes' }),
    )
    fireEvent.click(screen.getByRole('radio', { name: 'Not home' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save knock' }))

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

  // The two-tap claim is the whole reason the quick chips exist, and it is
  // measured by `logMode` — so the follow-up must sit behind the save, never in
  // front of it.
  it('logs the door on the single quick tap, with no reason attached', async () => {
    const posted: unknown[] = []
    api.mock('POST /v1/door-knocking/interactions', ({ body }) => {
      posted.push(body)
      return {
        status: 200,
        data: { personId: 'person-1', knockStatus: 'not_a_voter' },
      }
    })

    render(<WalkView turfId={3} />)
    await openPersonSheet('105 Elm St')
    fireEvent.click(screen.getByRole('button', { name: 'Not a voter' }))

    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toMatchObject({
      stopTargetId: 21,
      outcome: 'not_a_voter',
    })
    expect(trackEvent).toHaveBeenCalledWith(EVENTS.DoorKnocking.DoorLogged, {
      outcome: 'not_a_voter',
      knockStatus: 'not_a_voter',
      hasNote: false,
      logMode: 'quick',
    })
    // Nothing about a reason reaches the knock write — it is a different field
    // on a different endpoint.
    expect(JSON.stringify(posted[0])).not.toContain('moved')
  })

  // Advancing here would ask "what happened?" and take the answer away in the
  // same frame. The door is saved either way, so walking off costs nothing.
  it('holds the sheet on the logged door so the follow-up can be answered', async () => {
    logNotAVoter()

    render(<WalkView turfId={3} />)
    await openPersonSheet('105 Elm St')
    fireEvent.click(screen.getByRole('button', { name: 'Not a voter' }))

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

    render(<WalkView turfId={3} />)
    await openPersonSheet('105 Elm St')
    fireEvent.click(screen.getByRole('button', { name: 'Not a voter' }))
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

    render(<WalkView turfId={3} />)
    await waitFor(() =>
      expect(screen.getByText('1/2 logged')).toBeInTheDocument(),
    )

    await openPersonSheet('105 Elm St')
    fireEvent.click(screen.getByRole('button', { name: 'Not a voter' }))
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

    render(<WalkView turfId={3} />)
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

    render(<WalkView turfId={3} />)

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
      screen.getByText(/Support unknown/, { selector: 'span' }),
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

    render(<WalkView turfId={3} />)
    await openPersonSheet('105 Elm St')
    fireEvent.click(screen.getByRole('button', { name: 'Not a voter' }))
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

    render(<WalkView turfId={3} />)
    await openPersonSheet('105 Elm St')
    fireEvent.click(screen.getByRole('button', { name: 'Not a voter' }))
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

    render(<WalkView turfId={3} />)
    await openPersonSheet('105 Elm St')
    fireEvent.click(screen.getByRole('button', { name: 'Not a voter' }))
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

    render(<WalkView turfId={3} />)
    await openPersonSheet('105 Elm St')
    fireEvent.click(screen.getByRole('button', { name: 'Not home' }))
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
    knockStatus: 'unknown' as const,
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

  it('opens the next unlogged door without a trip back to the list', async () => {
    mockRoute([
      stop(11, 1, '105 Elm St', [target(21, 'Dorian Fen')]),
      stop(12, 2, '210 Cedar Row', [target(22, 'Marisol Vega')]),
    ])
    logNotHome('person-21')

    render(<WalkView turfId={3} />)
    await openPersonSheet('105 Elm St')
    fireEvent.click(screen.getByRole('button', { name: 'Not home' }))

    // The sheet stays open on the next person rather than closing.
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Marisol Vega' }),
      ).toBeInTheDocument(),
    )
    expect(screen.getByText('Log this door')).toBeInTheDocument()
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

    render(<WalkView turfId={3} />)
    await openPersonSheet('105 Elm St')
    fireEvent.click(screen.getByRole('button', { name: 'Not home' }))

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

    render(<WalkView turfId={3} />)
    await openPersonSheet('105 Elm St')
    fireEvent.click(screen.getByRole('button', { name: 'Not home' }))

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

    render(<WalkView turfId={3} />)
    await openPersonSheet('105 Elm St')
    fireEvent.click(screen.getByRole('button', { name: 'Not home' }))

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

    render(<WalkView turfId={3} />)
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

    fireEvent.click(screen.getByRole('button', { name: 'Not home' }))

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Winnie Fen' }),
      ).toBeInTheDocument(),
    )
  })

  // Nothing ahead means the walk is done for this pass; anything skipped is
  // left on the list rather than dragging the canvasser back up the street.
  it('closes the sheet when the last door is logged', async () => {
    mockRoute([stop(11, 1, '105 Elm St', [target(21, 'Dorian Fen')])])
    logNotHome('person-21')

    render(<WalkView turfId={3} />)
    await openPersonSheet('105 Elm St')
    fireEvent.click(screen.getByRole('button', { name: 'Not home' }))

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

    render(<WalkView turfId={3} />)
    await openPersonSheet('105 Elm St')
    expect(
      screen.getByText('No previous outreach to this resident.'),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Not home' }))
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

    render(<WalkView turfId={3} />)
    await openPersonSheet('105 Elm St')
    fireEvent.click(screen.getByRole('button', { name: 'Not home' }))
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

    render(<WalkView turfId={3} />)
    await openPersonSheet('105 Elm St')
    fireEvent.click(screen.getByRole('button', { name: 'Not home' }))
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

    render(<WalkView turfId={3} />)
    await openPersonSheet('105 Elm St')
    fireEvent.click(screen.getByRole('button', { name: 'Not home' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Not home' }))
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

    render(<WalkView turfId={3} />)
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

    fireEvent.click(screen.getByRole('button', { name: 'Not home' }))
    // Advances to the housemate, whose knock then fails.
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Winnie Fen' }),
      ).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Not home' }))
    await waitFor(() => expect(screen.getByText(/Saving failed/)).toBeTruthy())

    // Back to the logged housemate, which is what asks for the fresh serve,
    // and then forward again to retry the door that failed.
    fireEvent.click(screen.getByRole('button', { name: 'Dorian Fen' }))
    await waitFor(() => expect(serves).toBe(2))
    fireEvent.click(screen.getByRole('button', { name: 'Winnie Fen' }))
    await waitFor(() =>
      expect(screen.getByText('Log this door')).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Not home' }))

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

    render(<WalkView turfId={3} />)
    await openPersonSheet('105 Elm St')
    fireEvent.click(screen.getByRole('button', { name: 'Not home' }))
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Marisol Vega' }),
      ).toBeInTheDocument(),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Not home' }))
    await waitFor(() => expect(keys).toHaveLength(2))
    expect(keys[1]).toMatch(/[0-9a-f-]{36}/)
    expect(keys[1]).not.toBe(keys[0])
  })
})
