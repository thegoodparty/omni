import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { DoorKnockingRoutePayload } from '@goodparty_org/contracts'
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
    logNotAVoter()
    api.mock('POST /v1/door-knocking/not-a-voter', {
      status: 200,
      data: { personId: 'person-1', notAVoterReason: 'deceased' },
    })

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
    logNotAVoter()
    api.mock('POST /v1/door-knocking/not-a-voter', {
      status: 200,
      data: { personId: 'person-1', notAVoterReason: 'moved' },
    })

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
