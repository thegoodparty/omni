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
          // Carried so the omission assertions below can fail. The
          // eleven-attribute demographic profile rides the route payload for
          // the app's person sheet and is deliberately absent from this page,
          // for the reason the cell number above it is: paper leaves the
          // building and stops being access-controlled when it does.
          registeredVoter: true,
          turnoutLikelihood: 'Super',
          maritalStatus: 'Likely Married',
          hasChildrenUnder18: 'Yes',
          veteranStatus: 'Yes',
          homeowner: 'Likely',
          businessOwner: 'Yes',
          levelOfEducation: 'Graduate Degree',
          estimatedIncomeAmount: 82000,
          language: 'Spanish',
          ethnicityGroup: 'Hispanic',
          // ADR 0011, carried for the same reason and with more force again:
          // saved contact notes are free text a named person typed about a
          // named voter, which is the largest disclosure on this payload.
          notes: {
            entries: [
              {
                id: '019826f4-0000-7000-8000-000000000001',
                personId: 'person-1',
                body: 'Do not ring the bell, the dog bites',
                createdAt: '2026-07-01T15:00:00.000Z',
                updatedAt: '2026-07-01T15:00:00.000Z',
                actorName: null,
              },
            ],
            total: 9,
          },
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

// The grid is one row per resident, so most assertions are about what is in a
// person's row rather than what is somewhere on the page — the difference
// between the address column being merged down a household and the address
// simply appearing.
const rowFor = (name: string): HTMLElement => {
  const row = screen.getByText(name).closest('tr')
  if (row === null) throw new Error(`no row for ${name}`)
  return row
}

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

  it('rules the columns the handoff asks for, and heads them', () => {
    renderSheet([stop()])

    const heads = screen
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent)
    expect(heads).toEqual([
      '#',
      'Name',
      'Age',
      'Address',
      'Answered',
      'Support',
      'Will vote',
      'Notes',
    ])
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
      .getAllByText(/Elm St|Cedar Row/)
      .map((cell) => cell.textContent)
    expect(addresses).toEqual(['105 Elm St', '210 Cedar Row'])
  })

  // The stop number and the address are the household's, not the person's: a
  // canvasser reads a filled stop cell as "walk here next", so repeating it for
  // everyone behind one door would turn one door into three stops. The dotted
  // rule and the empty cells are what group them.
  it('merges the stop number and address down a household', () => {
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
                knockStatus: 'unknown',
                mayHaveMoved: false,
                doNotKnock: false,
              },
              {
                stopTargetId: 22,
                personId: 'person-2',
                name: 'Marisol Vega',
                age: 44,
                politicalParty: 'Independent',
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

    const cells = (row: HTMLElement) =>
      Array.from(row.querySelectorAll('td')).map((cell) => cell.textContent)

    expect(cells(rowFor('Dorian Fen'))[0]).toBe('1')
    expect(cells(rowFor('Marisol Vega'))[0]).toBe('')
    expect(screen.getAllByText('105 Elm St')).toHaveLength(1)
  })

  // How long the walk to this stop takes is a fact about the *stop*, so it rides
  // in the address cell under the door it belongs to. Every other fixture here
  // leaves `legSeconds` at 0, which is the same as a first stop — without this
  // the `> 0` guard, `formatDuration` and the sub-line could all break silently.
  it('prints the walk time from the previous stop', () => {
    renderSheet([stop({ legSeconds: 300 })])

    expect(
      within(rowFor('Dorian Fen')).getByText('5 min from last'),
    ).toBeInTheDocument()
  })

  it('leaves the walk time off the first stop of a route', () => {
    renderSheet([stop({ legSeconds: 0 })])

    expect(screen.queryByText(/from last/)).toBeNull()
  })

  // The whole point of the sheet: somewhere to write the answers that the
  // in-app form will later ask for, in the same words.
  it('gives every unknocked person the same options the app offers', () => {
    renderSheet([stop()])

    const row = rowFor('Dorian Fen')
    // All five outcomes, because paper cannot branch the way the app's
    // walkthrough does — every ending has to be offered at once.
    for (const label of [
      'Answered',
      'Not home',
      'Inaccessible',
      'Refused to engage',
      'Not a voter',
    ]) {
      expect(within(row).getByText(label)).toBeInTheDocument()
    }
    // Support and will-vote are three-way in the app and three-way here, so
    // each of the three labels appears once per question.
    for (const label of ['Yes', 'No', 'Unsure']) {
      expect(within(row).getAllByText(label)).toHaveLength(2)
    }
  })

  // The handoff's Support column offers Strong / Lean / Undec / No and its
  // Answered column offers a "Moved". Both contradict the Voter Outreach 2.0
  // canvas as well as our enum — the canvas ticks `Yes / No / Unsure` for both
  // follow-ups, has no "Moved" door outcome, and its only "Strong" is a value of
  // a voter's CRM support attribute — so they are an error in the handoff. What
  // this pins is that the boxes stay generated from the form's own constants,
  // because a box on paper the form cannot accept is an answer nobody can file.
  //
  // Asserted as the exact set of labels rather than as words the page must not
  // contain, because the page legitimately says "may have moved" and "Moved
  // away — skip this resident" elsewhere. What must not appear is a *box*
  // offering an answer, so the boxes are what this reads.
  it('offers no answer the app has no value for', () => {
    renderSheet([stop()])

    // `:not(.ws-box)` because the box is a span too — an empty one, since a
    // printer would drop a filled background and every mark on this page has to
    // be a border.
    const offered = Array.from(
      document.querySelectorAll('.ws-opt span:not(.ws-box)'),
    ).map((label) => label.textContent)
    expect(offered).toEqual([
      'Answered',
      'Not home',
      'Inaccessible',
      'Refused to engage',
      'Not a voter',
      'Yes',
      'No',
      'Unsure',
      'Yes',
      'No',
      'Unsure',
    ])
  })

  // Phones are on the route payload for the app's person sheet, but paper
  // leaves the building and is not access-controlled once it does. The sheet
  // omits them deliberately — this asserts the omission rather than trusting it,
  // since the fixture above carries a cell number. The handoff rules an 11%
  // Phone column; see the `### Paper` section of AGENTS.md for why it is not
  // implemented.
  it('never prints a phone number, whatever column the handoff rules', () => {
    renderSheet([stop()])

    const page = document.body.textContent ?? ''
    expect(page).not.toMatch(/555-0101/)
    expect(page).not.toMatch(/phone/i)
    expect(page).not.toMatch(/landline/i)
  })

  // The same rule as the phone numbers above, applied to a larger disclosure:
  // the eleven-attribute demographic profile is screen-only, because a printed
  // profile of a named voter stops being access-controlled the moment it leaves
  // the building. The fixture carries all eleven, so this asserts the omission.
  //
  // Asserted against the page's whole text rather than field by field, since a
  // leak would most likely arrive as a new block nobody thought to name here.
  it('never prints the demographic profile', () => {
    renderSheet([stop()])

    const page = document.body.textContent ?? ''
    for (const leak of [
      /Likely Married/,
      /Graduate Degree/,
      /Hispanic/,
      /Spanish/,
      /82,?000/,
      /\$75k/,
      /marital/i,
      /veteran/i,
      /homeowner/i,
      /ethnicity/i,
      /education/i,
      /income/i,
      /turnout/i,
      /demographic/i,
    ]) {
      expect(page).not.toMatch(leak)
    }
  })

  // ADR 0011, and the same argument once more. The fixture carries a saved note
  // and a count of nine, so both halves of the block can fail — the count is a
  // disclosure of its own, since "9 notes on file" says how much has been
  // written about this voter even with none of it printed.
  //
  // Named by its body rather than by the word "Notes", because the sheet rules a
  // Notes column for every person to write in: that blank is the point of the
  // page, and asserting /notes/i would fail on the feature working.
  it('never prints a saved contact note', () => {
    renderSheet([stop()])

    const page = document.body.textContent ?? ''
    expect(page).not.toMatch(/Do not ring the bell/)
    expect(page).not.toMatch(/9 notes/i)
    expect(page).not.toMatch(/of 9/)
  })

  // Age has its own column since the design handoff, so printing it on the meta
  // line under the name as well would state a voter's age twice in one row.
  it('prints the age in its own cell and the party under the name', () => {
    renderSheet([stop()])

    const cells = Array.from(rowFor('Dorian Fen').querySelectorAll('td')).map(
      (cell) => cell.textContent,
    )
    expect(cells[1]).toBe('Dorian FenIndependent')
    expect(cells[2]).toBe('31')
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

    const row = rowFor('Marisol Vega')
    expect(
      within(row).getByText('Already logged: Supporter'),
    ).toBeInTheDocument()
    expect(within(row).queryByText('Not home')).toBeNull()
    expect(row.querySelectorAll('.ws-box')).toHaveLength(0)
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

    // The name stays, so the sheet still matches the app's stop numbering.
    const row = rowFor('Dorian Fen')
    expect(
      within(row).getByText('Do not knock — skip this door'),
    ).toBeInTheDocument()
    expect(row.querySelectorAll('.ws-box')).toHaveLength(0)
    expect(within(row).queryByText('Already logged: Supporter')).toBeNull()
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

    expect(
      within(rowFor('Dorian Fen')).getByText('Moved away — skip this resident'),
    ).toBeInTheDocument()
    expect(
      within(rowFor('Marisol Vega')).getByText(
        'Deceased — skip this resident, and do not ask for them by name',
      ),
    ).toBeInTheDocument()
    // Both names stay on the page; neither gets a box to tick.
    expect(document.querySelectorAll('.ws-box')).toHaveLength(0)
    // Nobody knockable at this stop, so the header's evening is empty while the
    // rows below still carry the two instructions.
    expect(screen.getByText(/1 stops · 1 doors · 0 people/)).toBeInTheDocument()
  })

  // A walkable multi-unit building routes as one stop with an address per
  // unit. Without the unit line a canvasser has names but no door to knock.
  it('names the unit when a stop covers more than one address', () => {
    renderSheet([
      stop({
        legSeconds: 180,
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

    // Each unit in its own row's address cell, rather than the building in both.
    expect(
      within(rowFor('Priya Raman')).getByText('400 Birch Ln Apt 1'),
    ).toBeInTheDocument()
    expect(
      within(rowFor('Walter Boone')).getByText('400 Birch Ln Apt 2'),
    ).toBeInTheDocument()
    // The other-residents note sits in the unit's own row, so it needs no
    // address of its own to say which door it is about.
    expect(
      within(rowFor('Priya Raman')).getByText('Also here: Anil Raman'),
    ).toBeInTheDocument()
    // One stop, so one stop number and one walk time however many doors it
    // holds: a second "1" against the second unit reads as a second stop, and
    // the walk time is how long it took to reach the building.
    const seq = (name: string) =>
      rowFor(name).querySelectorAll('td')[0]?.textContent
    expect(seq('Priya Raman')).toBe('1')
    expect(seq('Walter Boone')).toBe('')
    expect(screen.getAllByText('3 min from last')).toHaveLength(1)
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

    const row = rowFor('Dorian Fen')
    expect(within(row).getByText('may have moved')).toBeInTheDocument()
    expect(within(row).getByText('Also here: Ruben Vega')).toBeInTheDocument()
    // No age in the voter file prints an empty cell, not a dash: a canvasser
    // reads anything in that cell as a fact about the person.
    expect(row.querySelectorAll('td')[2]?.textContent).toBe('')
  })

  // Nothing on paper reaches the voter records by itself, and a canvasser who
  // assumes otherwise loses the day's work. Above the grid, in the words both
  // paper surfaces quote from `walkFacts`.
  it('says the sheet has to be logged in the app', () => {
    renderSheet([stop()])

    expect(
      screen.getAllByText(/Log these doors in the app when you.re back online/)
        .length,
    ).toBeGreaterThan(0)
  })

  it('says how to fill the sheet in', () => {
    renderSheet([stop()])

    expect(
      screen.getByText(/Circle or tick a box, write short notes/),
    ).toBeInTheDocument()
  })

  // The sheet renders in Node, whose clock is UTC, so any date it stamps
  // itself is tomorrow's for an evening print anywhere in the US. The
  // canvasser writes the date instead — and, for want of a counter a browser
  // will resolve in flow content, the page number too.
  it('leaves the date and the page number to the canvasser', () => {
    renderSheet([stop()])

    expect(screen.getByText(/^Date/)).toBeInTheDocument()
    expect(screen.getByText(/^Canvasser/)).toBeInTheDocument()
    expect(screen.getByText(/^Page/)).toBeInTheDocument()
    expect(screen.queryByText(/Printed/)).toBeNull()
    // Chrome resolves `counter(pages)` to nothing outside an `@page` margin
    // box, which prints as "Page 0 of 0" — worse than a blank, because it
    // looks like a number.
    expect(document.body.textContent).not.toMatch(/Page 0 of 0/)
  })

  // A route is sixteen sheets and they get separated, so the signature belongs
  // on every one. `tfoot` is the region print engines repeat per page; a block
  // after the table prints once, on the last.
  it('signs every page from the table footer', () => {
    renderSheet([stop()])

    const logo = screen.getByAltText('GoodParty.org')
    expect(logo.closest('tfoot')).not.toBeNull()
    expect(
      screen.getByText('Empowering people to run, win, and serve'),
    ).toBeInTheDocument()
  })

  it('handles a route with no stops', () => {
    renderSheet([])

    expect(screen.getByText('This route has no stops.')).toBeInTheDocument()
    // No table to repeat inside, so the signature prints on its own.
    expect(screen.getByAltText('GoodParty.org')).toBeInTheDocument()
  })

  // ENG-10876. On screen ADR 0009's activity feed answers "have we been here
  // before"; paper carried no history at all, so an answered-but-unsure door and
  // a door nobody has ever knocked printed the same blank form. The line prints
  // for a flagged resident too — whether we have been here is a fact about them
  // rather than about which of the three branches follows. The handoff has no
  // line for it; dropping it would regress a shipped fix.
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

    const line = 'Last contact: June 2026 · Door knock: Answered'
    expect(within(rowFor('Dorian Fen')).getByText(line)).toBeInTheDocument()
    // Still gets boxes: unsure support is a door worth re-asking.
    expect(rowFor('Dorian Fen').querySelectorAll('.ws-box').length).toBe(11)
    // And the flagged housemate keeps their instruction beside the same line.
    const mate = rowFor('Marisol Vega')
    expect(within(mate).getByText(line)).toBeInTheDocument()
    expect(
      within(mate).getByText('Moved away — skip this resident'),
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
