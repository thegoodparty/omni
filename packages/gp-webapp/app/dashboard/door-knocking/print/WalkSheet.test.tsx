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
  render(<WalkSheet turfName="Elm & Cedar" payload={payload(stops)} />)

describe('WalkSheet', () => {
  it('heads the sheet with the turf and what the walk costs', () => {
    renderSheet([stop(), stop({ id: 12, seq: 2 })])

    expect(
      screen.getByRole('heading', { name: 'Elm & Cedar' }),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        /2 stops · 2 doors · 2 people · Walking loop · 31 min · 2\.0 mi/,
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
    expect(within(person).getByText('Will they vote?')).toBeInTheDocument()
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
})
