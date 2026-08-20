import { describe, expect, it } from 'vitest'
import { screen, within } from '@testing-library/react'
import {
  DoorKnockingRoutePayload,
  RoutePayloadStop,
} from '@goodparty_org/contracts'
import { render } from 'helpers/test-utils/render'
import WalkSheet from './WalkSheet'

const stop = (overrides: Partial<RoutePayloadStop> = {}): RoutePayloadStop => ({
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
          politicalParty: 'Independent',
          cellPhone: '(312) 555-0101',
          landline: null,
          knockStatus: 'unknown',
          mayHaveMoved: false,
          doNotKnock: false,
        },
      ],
      otherResidents: [],
    },
  ],
  ...overrides,
})

const payload = (stops: RoutePayloadStop[]): DoorKnockingRoutePayload => ({
  route: {
    id: 5,
    doorKnockingTurfId: 3,
    mode: 'walk',
    loop: true,
    totalSeconds: 1860,
    totalMeters: 3218,
    stopCount: stops.length,
    createdAt: new Date('2026-07-21T00:00:00Z'),
  },
  pathGeometry: null,
  stops,
})

const renderSheet = (stops: RoutePayloadStop[]) =>
  render(
    <WalkSheet turfId="3" turfName="Elm & Cedar" payload={payload(stops)} />,
  )

describe('WalkSheet', () => {
  it('heads the sheet with the turf and what the walk costs', () => {
    renderSheet([stop(), stop({ id: 12, seq: 2 })])

    expect(
      screen.getByRole('heading', { name: 'Elm & Cedar' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        /2 stops · 2 doors · 2 people · Walking loop · 31 min travel · 2\.0 mi/,
      ),
    ).toBeInTheDocument()
  })

  // Doors are addresses. A single stop covering a three-unit building is one
  // stop, three doors, and however many voters live across them — the header
  // used to report the people count under the "doors" label.
  it('counts doors as addresses, not people', () => {
    const multiUnit = stop({
      addresses: [
        {
          addressKey: '105|elm|st|1a',
          address: '105 Elm St Apt 1A',
          targets: [
            {
              stopTargetId: 31,
              personId: 'person-a',
              name: 'Ada One',
              age: 40,
              politicalParty: 'Democratic',
              cellPhone: null,
              landline: null,
              knockStatus: 'unknown',
              mayHaveMoved: false,
              doNotKnock: false,
            },
            {
              stopTargetId: 32,
              personId: 'person-b',
              name: 'Bo Two',
              age: 42,
              politicalParty: 'Democratic',
              cellPhone: null,
              landline: null,
              knockStatus: 'unknown',
              mayHaveMoved: false,
              doNotKnock: false,
            },
          ],
          otherResidents: [],
        },
        {
          addressKey: '105|elm|st|1b',
          address: '105 Elm St Apt 1B',
          targets: [
            {
              stopTargetId: 33,
              personId: 'person-c',
              name: 'Cy Three',
              age: 44,
              politicalParty: 'Republican',
              cellPhone: null,
              landline: null,
              knockStatus: 'unknown',
              mayHaveMoved: false,
              doNotKnock: false,
            },
          ],
          otherResidents: [],
        },
      ],
    })

    renderSheet([multiUnit])

    expect(
      screen.getByText(/1 stops · 2 doors · 3 people · Walking loop/),
    ).toBeInTheDocument()
  })

  // Paper is walked in order, and the payload isn't guaranteed to arrive in it.
  it('prints stops in seq order', () => {
    renderSheet([
      stop({ id: 12, seq: 2, displayAddress: '210 Cedar Row' }),
      stop({ id: 11, seq: 1, displayAddress: '105 Elm St' }),
    ])

    const addresses = screen
      .getAllByRole('listitem')
      .map((item) => within(item).getByText(/Elm St|Cedar Row/).textContent)
    expect(addresses).toEqual(['105 Elm St', '210 Cedar Row'])
  })

  // The whole point of the sheet: somewhere to write the answers that the
  // in-app form will later ask for, in the same words.
  it('gives every unknocked person the same questions the app asks', () => {
    renderSheet([stop()])

    const person = screen.getByRole('listitem')
    expect(within(person).getByText('Dorian Fen')).toBeInTheDocument()
    expect(within(person).getByText('31 · Independent')).toBeInTheDocument()
    expect(within(person).getByText('Did they answer?')).toBeInTheDocument()
    expect(within(person).getByText('Do they support you?')).toBeInTheDocument()
    expect(
      within(person).getByText('Will they vote this election?'),
    ).toBeInTheDocument()
    // All five outcomes, because paper cannot branch the way the app's
    // walkthrough does — every ending has to be offered at once.
    for (const label of [
      'Answered',
      'Not home',
      'Inaccessible',
      'Refused to engage',
      'Not a voter',
    ]) {
      expect(within(person).getByText(label)).toBeInTheDocument()
    }
    expect(within(person).getByText('Notes')).toBeInTheDocument()
  })

  // Phones are on the route payload for the app's person sheet, but paper
  // leaves the building and is not access-controlled once it does. The sheet
  // omits them deliberately — this asserts the omission rather than trusting it,
  // since the fixture above carries a cell number.
  it('never prints a phone number', () => {
    renderSheet([stop()])

    expect(screen.queryByText(/555-0101/)).toBeNull()
    expect(screen.queryByText(/Cell phone/i)).toBeNull()
    expect(screen.queryByText(/Landline/i)).toBeNull()
  })

  // A door already logged in the app must not come back as a blank form —
  // that's how a knock gets repeated, or an answer overwritten on transcription.
  it('prints the recorded answer instead of blank boxes', () => {
    renderSheet([
      stop({
        addresses: [
          {
            addressKey: '105|elm|st',
            address: '105 Elm St',
            targets: [
              {
                stopTargetId: 21,
                personId: 'person-1',
                name: 'Marisol Vega',
                age: 44,
                politicalParty: 'Democratic',
                cellPhone: '(312) 555-0102',
                landline: '(312) 555-0103',
                knockStatus: 'supporter',
                mayHaveMoved: false,
                doNotKnock: false,
              },
            ],
            otherResidents: [],
          },
        ],
      }),
    ])

    const person = screen.getByRole('listitem')
    expect(
      within(person).getByText('Already logged: Supporter'),
    ).toBeInTheDocument()
    expect(within(person).queryByText('Did they answer?')).toBeNull()
  })

  // ADR 0007. Turf evaluation keeps flagged people off new lists, but paper
  // freezes the moment it prints, so the sheet has to carry the instruction
  // itself — otherwise the one surface used without the app is the one that
  // ignores it.
  it('prints a skip instead of a form for a flagged door', () => {
    renderSheet([
      stop({
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
                politicalParty: 'Independent',
                cellPhone: null,
                landline: null,
                // Previously knocked, and flagged since: the instruction wins
                // over what was logged at the door before.
                knockStatus: 'supporter',
                mayHaveMoved: false,
                doNotKnock: true,
              },
            ],
            otherResidents: [],
          },
        ],
      }),
    ])

    const person = screen.getByRole('listitem')
    // The name stays, so the sheet still matches the app's stop numbering.
    expect(within(person).getByText('Dorian Fen')).toBeInTheDocument()
    expect(
      within(person).getByText('Do not knock — skip this door'),
    ).toBeInTheDocument()
    expect(within(person).queryByText('Did they answer?')).toBeNull()
    expect(within(person).queryByText('Notes')).toBeNull()
    expect(within(person).queryByText('Already logged: Supporter')).toBeNull()
  })

  // The header is what an evening gets budgeted against, so it counts
  // conversations that can happen — while the rows below still list the flagged
  // name, because that is how paper carries the instruction.
  it('leaves flagged residents out of the header count but not the page', () => {
    const resident = {
      personId: 'person-1',
      name: 'Dorian Fen',
      age: 31,
      politicalParty: 'Independent' as const,
      cellPhone: null,
      landline: null,
      knockStatus: 'unknown' as const,
      mayHaveMoved: false,
    }
    renderSheet([
      stop({
        addresses: [
          {
            addressKey: '105|elm|st',
            address: '105 Elm St',
            targets: [
              { ...resident, stopTargetId: 21, doNotKnock: false },
              {
                ...resident,
                stopTargetId: 22,
                personId: 'person-2',
                name: 'Marisol Vega',
                doNotKnock: true,
              },
            ],
            otherResidents: [],
          },
        ],
      }),
    ])

    expect(screen.getByText(/1 stops · 1 doors · 1 people/)).toBeInTheDocument()
    expect(screen.getByText('Marisol Vega')).toBeInTheDocument()
  })

  // ADR 0008. Paper freezes at print time and is the surface used without the
  // app, so a resident who moved away or died carries their instruction on the
  // page — a blank form beside their name is how a door gets knocked anyway.
  it('prints the reason instead of a form, and words the two reasons apart', () => {
    const resident = {
      personId: 'person-1',
      name: 'Dorian Fen',
      age: 31,
      politicalParty: 'Independent' as const,
      cellPhone: null,
      landline: null,
      knockStatus: 'unknown' as const,
      mayHaveMoved: false,
      doNotKnock: false,
    }
    renderSheet([
      stop({
        addresses: [
          {
            addressKey: '105|elm|st',
            address: '105 Elm St',
            targets: [
              {
                ...resident,
                stopTargetId: 21,
                notAVoterReason: 'moved' as const,
              },
              {
                ...resident,
                stopTargetId: 22,
                personId: 'person-2',
                name: 'Marisol Vega',
                notAVoterReason: 'deceased' as const,
              },
            ],
            otherResidents: [],
          },
        ],
      }),
    ])

    const person = screen.getByRole('listitem')
    expect(
      within(person).getByText('Moved away — skip this resident'),
    ).toBeInTheDocument()
    expect(
      within(person).getByText(
        'Deceased — skip this resident, and do not ask for them by name',
      ),
    ).toBeInTheDocument()
    // Both names stay on the page; neither gets tick-boxes.
    expect(within(person).getByText('Marisol Vega')).toBeInTheDocument()
    expect(within(person).queryByText('Did they answer?')).toBeNull()
    // Nobody knockable at this stop, so the header's evening is empty while the
    // rows below still carry the two instructions.
    expect(screen.getByText(/1 stops · 1 doors · 0 people/)).toBeInTheDocument()
  })

  // A walkable multi-unit building routes as one stop with an address per
  // unit. Without the unit line a canvasser has names but no door to knock,
  // and "this address" would be the building rather than where the person is.
  it('names the unit when a stop covers more than one address', () => {
    renderSheet([
      stop({
        displayAddress: '400 Birch Ln',
        addresses: [
          {
            addressKey: '400|birch|apt1',
            address: '400 Birch Ln Apt 1',
            targets: [
              {
                stopTargetId: 31,
                personId: 'person-a',
                name: 'Priya Raman',
                age: 29,
                politicalParty: null,
                cellPhone: null,
                landline: null,
                knockStatus: 'unknown',
                mayHaveMoved: false,
                doNotKnock: false,
              },
            ],
            otherResidents: [{ name: 'Anil Raman' }],
          },
          {
            addressKey: '400|birch|apt2',
            address: '400 Birch Ln Apt 2',
            targets: [
              {
                stopTargetId: 32,
                personId: 'person-b',
                name: 'Walter Boone',
                age: 68,
                politicalParty: 'Republican',
                cellPhone: null,
                landline: null,
                knockStatus: 'unknown',
                mayHaveMoved: false,
                doNotKnock: false,
              },
            ],
            otherResidents: [],
          },
        ],
      }),
    ])

    const item = screen.getByRole('listitem')
    expect(within(item).getByText('400 Birch Ln Apt 1')).toBeInTheDocument()
    expect(within(item).getByText('400 Birch Ln Apt 2')).toBeInTheDocument()
    // The other-residents note names its own unit, not the building.
    expect(
      within(item).getByText('Also at 400 Birch Ln Apt 1: Anil Raman'),
    ).toBeInTheDocument()
    expect(within(item).queryByText(/Also at this address/)).toBeNull()
  })

  it('flags a person who may have moved', () => {
    renderSheet([
      stop({
        addresses: [
          {
            addressKey: '105|elm|st',
            address: '105 Elm St',
            targets: [
              {
                stopTargetId: 21,
                personId: 'person-1',
                name: 'Dorian Fen',
                age: null,
                politicalParty: null,
                cellPhone: null,
                landline: null,
                knockStatus: 'unknown',
                mayHaveMoved: true,
                doNotKnock: false,
              },
            ],
            otherResidents: [{ name: 'Ruben Vega' }],
          },
        ],
      }),
    ])

    expect(screen.getByText('may have moved')).toBeInTheDocument()
    expect(
      screen.getByText('Also at this address: Ruben Vega'),
    ).toBeInTheDocument()
  })

  // Nothing on paper reaches the voter records by itself, and a canvasser who
  // assumes otherwise loses the day's work.
  it('says the sheet has to be logged in the app', () => {
    renderSheet([stop()])

    expect(
      screen.getByText(/Log these doors in the app when you.re back online/),
    ).toBeInTheDocument()
  })

  // The sheet renders in Node, whose clock is UTC, so any date it stamps
  // itself is tomorrow's for an evening print anywhere in the US. The
  // canvasser writes the date instead.
  it('leaves the date to the canvasser rather than stamping one', () => {
    renderSheet([stop()])

    expect(screen.getByText('Date walked')).toBeInTheDocument()
    expect(screen.queryByText(/Printed/)).toBeNull()
  })

  it('handles a route with no stops', () => {
    renderSheet([])

    expect(screen.getByText('This route has no stops.')).toBeInTheDocument()
  })

  // ENG-10876. On screen ADR 0009's activity feed answers "have we been here
  // before"; paper carried no history at all, so an answered-but-unsure door and
  // a door nobody has ever knocked printed the same blank form. The line prints
  // for a flagged resident too — whether we have been here is a fact about them
  // rather than about which of the three branches follows.
  it('prints when a resident was last contacted, alongside whatever follows', () => {
    const resident = {
      personId: 'person-1',
      name: 'Dorian Fen',
      age: 31,
      politicalParty: 'Independent' as const,
      cellPhone: null,
      landline: null,
      knockStatus: 'unknown' as const,
      mayHaveMoved: false,
      doNotKnock: false,
      history: [
        {
          type: 'DOOR_KNOCK' as const,
          date: '2026-06-12T18:00:00.000Z',
          data: {
            activityId: 'dk-1',
            outcome: 'answered' as const,
            supportAnswer: 'unsure' as const,
            // Free text about a named voter never travels onto paper.
            note: 'Dog in the yard, come back Saturday',
            manual: false,
          },
        },
      ],
    }
    renderSheet([
      stop({
        addresses: [
          {
            addressKey: '105|elm|st',
            address: '105 Elm St',
            targets: [
              { ...resident, stopTargetId: 21 },
              {
                ...resident,
                stopTargetId: 22,
                personId: 'person-2',
                name: 'Marisol Vega',
                notAVoterReason: 'moved' as const,
              },
            ],
            otherResidents: [],
          },
        ],
      }),
    ])

    const person = screen.getByRole('listitem')
    expect(
      within(person).getAllByText(
        'Last contact: June 2026 · Door knock: Answered',
      ),
    ).toHaveLength(2)
    // Still gets the questions: unsure support is a door worth re-asking.
    expect(within(person).getByText('Did they answer?')).toBeInTheDocument()
    // And the flagged housemate keeps their instruction beside the same line.
    expect(
      within(person).getByText('Moved away — skip this resident'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/Dog in the yard/)).toBeNull()
  })

  // The grid version of the same list, built server-side. A link rather than a
  // button keeps this page free of client JavaScript, which is the whole point
  // of rendering it on the server in the first place.
  it('offers the PDF, and only on screen', () => {
    renderSheet([stop()])

    const link = screen.getByRole('link', { name: 'Download PDF' })
    expect(link).toHaveAttribute('href', '/dashboard/door-knocking/print/3/pdf')
    // Both live in the instructions block, which is hidden when printed.
    expect(link.closest('.print\\:hidden')).not.toBeNull()
  })
})
