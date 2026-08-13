import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { DoorKnockingRoutePayload } from '@goodparty_org/contracts'
import { render, testQueryClient } from 'helpers/test-utils/render'
import { api } from 'helpers/test-utils/api-mocking'
import { EVENTS, trackEvent } from 'helpers/analyticsHelper'
import WalkView from './WalkView'

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

  it('renders stops in seq order with totals and the reached counter', async () => {
    render(<WalkView turfId={3} />)

    await waitFor(() =>
      expect(screen.getByText('105 Elm St')).toBeInTheDocument(),
    )
    // Distance comes from the same route payload as the duration; 2400m.
    expect(screen.getByText(/2 doors · 31m · 1.5 mi/)).toBeInTheDocument()
    expect(screen.getByText('1/2 reached')).toBeInTheDocument()
    const items = screen.getAllByRole('listitem')
    expect(within(items[0] as HTMLElement).getByText('Dorian Fen')).toBeTruthy()
    expect(
      within(items[1] as HTMLElement).getByText('Marisol Vega'),
    ).toBeTruthy()
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
      expect(screen.getByText('1/2 reached')).toBeInTheDocument(),
    )
    expect(unknownChip()).toHaveTextContent('Support unknown 1')

    await openPersonSheet('105 Elm St')
    fireEvent.click(screen.getByRole('button', { name: /don.t knock/i }))
    // Undo appearing is the flag landing; asserting the counts before the
    // mutation settles would read the pre-patch cache.
    await screen.findByRole('button', { name: 'Undo' })
    await closePersonSheet()

    expect(screen.getByText('1/1 reached')).toBeInTheDocument()
    expect(unknownChip()).toHaveTextContent('Support unknown 0')
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

    // Sheet closes and the reached counter reflects the new status.
    await waitFor(() => expect(screen.queryByText('Log this door')).toBeNull())
    expect(screen.getByText('2/2 reached')).toBeInTheDocument()

    expect(trackEvent).toHaveBeenCalledWith(EVENTS.DoorKnocking.DoorLogged, {
      outcome: 'answered',
      supportAnswer: 'supporter',
      knockStatus: 'supporter',
      hasNote: false,
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
    fireEvent.click(screen.getByRole('radio', { name: 'Not home' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save knock' }))

    await waitFor(() =>
      expect(screen.getByText(/Saving failed/)).toBeInTheDocument(),
    )
    expect(trackEvent).not.toHaveBeenCalled()
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
    fireEvent.click(screen.getByRole('radio', { name: 'Not home' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save knock' }))
    await waitFor(() => expect(keys).toHaveLength(1))

    // Close and reopen the sheet — the remount must not mint a new key,
    // or the server-side upsert can't dedupe the retry.
    await closePersonSheet()
    await openPersonSheet('105 Elm St')
    fireEvent.click(screen.getByRole('radio', { name: 'Not home' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save knock' }))
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
    fireEvent.click(screen.getByRole('radio', { name: 'Not home' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save knock' }))
    await waitFor(() => expect(keys).toHaveLength(1))
    await waitFor(() => expect(screen.queryByText('Log this door')).toBeNull())

    await openPersonSheet('105 Elm St')
    fireEvent.click(screen.getByRole('radio', { name: 'Not home' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save knock' }))
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
