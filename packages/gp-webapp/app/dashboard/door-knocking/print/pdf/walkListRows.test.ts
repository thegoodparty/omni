import { describe, expect, it } from 'vitest'
import { doorKnock, stop, target } from './walkListFixtures'
import { walkListFilename, walkListRows } from './walkListRows'

const household = (
  address: string,
  targets: ReturnType<typeof target>[],
  otherResidents: { name: string | null }[] = [],
) => ({
  addressKey: address.toLowerCase().replace(/\s+/g, '|'),
  address,
  targets,
  otherResidents,
})

describe('walkListRows', () => {
  it('emits one row per targeted resident, in walk order', () => {
    const rows = walkListRows([
      stop({
        id: 12,
        seq: 2,
        addresses: [household('210 Cedar Row', [target({ stopTargetId: 31 })])],
      }),
      stop({ id: 11, seq: 1 }),
    ])

    expect(rows.map((row) => [row.seq, row.address])).toEqual([
      [1, '105 Elm St'],
      [2, '210 Cedar Row'],
    ])
  })

  // The grid reads as one door per household. Only the first row of a
  // household carries the address; the renderer drops the top rule on the
  // rest, which is what makes the cell look merged.
  it('merges the address cell across a household', () => {
    const rows = walkListRows([
      stop({
        addresses: [
          household('105 Elm St', [
            target({ stopTargetId: 21, name: 'Dorian Fen' }),
            target({ stopTargetId: 22, name: 'Marisol Vega' }),
          ]),
        ],
      }),
    ])

    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.firstInHousehold)).toEqual([true, false])
    // Both rows still carry the address; the renderer decides whether to draw
    // it, so a split household could print it again if that ever changes.
    expect(rows.every((row) => row.address === '105 Elm St')).toBe(true)
  })

  // A walkable block of flats is ONE stop with an address per unit: the stop
  // number merges down the whole stop, the address only down each unit.
  it('merges the stop number across every unit of a multi-address stop', () => {
    const rows = walkListRows([
      stop({
        displayAddress: '400 Birch Ln',
        addresses: [
          household('400 Birch Ln Apt 1', [target({ stopTargetId: 31 })]),
          household('400 Birch Ln Apt 2', [target({ stopTargetId: 32 })]),
        ],
      }),
    ])

    expect(rows.map((row) => row.firstInStop)).toEqual([true, false])
    expect(rows.map((row) => row.firstInHousehold)).toEqual([true, true])
  })

  // Paper leaves the building and stops being access-controlled when it does.
  // The fixture carries a cell number so this asserts the omission rather than
  // trusting it — and it asserts against the whole model, because the renderer
  // cannot print what it was never handed.
  it('never carries a phone number into the PDF model', () => {
    const rows = walkListRows([
      stop({
        addresses: [
          household('105 Elm St', [
            target({ cellPhone: '(312) 555-0101', landline: '(312) 555-0102' }),
          ]),
        ],
      }),
    ])

    expect(JSON.stringify(rows)).not.toMatch(/555-010/)
  })

  // Same rule, larger disclosure. The eleven-attribute demographic profile is
  // screen-only for the reason the phone numbers are: paper leaves the building
  // and stops being access-controlled when it does. Asserted against the whole
  // model rather than the rendered page, because the renderer structurally
  // cannot print what it was never handed — which is the property worth
  // pinning, since a future column added to the row model would be reachable by
  // every renderer at once.
  //
  // The fixture carries a value for all eleven, so this fails if the model ever
  // starts carrying one.
  it('never carries the demographic profile into the PDF model', () => {
    const rows = walkListRows([
      stop({ addresses: [household('105 Elm St', [target()])] }),
    ])

    const model = JSON.stringify(rows)
    for (const leak of [
      /Likely Married/,
      /Graduate Degree/,
      /Hispanic/,
      /Spanish/,
      /82000/,
      /\$75k/,
      /Super/,
      /marital/i,
      /veteran/i,
      /homeowner/i,
      /ethnicity/i,
      /education/i,
      /income/i,
      /turnout/i,
      /demographic/i,
    ]) {
      expect(model).not.toMatch(leak)
    }
  })

  // A door already logged in the app must not come back as a blank form —
  // that's how a knock gets repeated, or an answer overwritten on transcription.
  it('prints the recorded answer instead of a blank form', () => {
    const rows = walkListRows([
      stop({
        addresses: [
          household('105 Elm St', [target({ knockStatus: 'supporter' })]),
        ],
      }),
    ])

    expect(rows[0]?.answer).toEqual({ kind: 'logged', label: 'Supporter' })
  })

  // ADR 0007. The flag outranks whatever was logged at that door before: an
  // instruction not to return is not retracted by an earlier conversation.
  it('prints a skip for a flagged door, even one already logged', () => {
    const rows = walkListRows([
      stop({
        addresses: [
          household('105 Elm St', [
            target({ knockStatus: 'supporter', doNotKnock: true }),
          ]),
        ],
      }),
    ])

    expect(rows[0]?.answer).toEqual({
      kind: 'skip',
      instruction: 'Do not knock — skip this door',
    })
    // The name stays, so the grid still matches the app's stop numbering.
    expect(rows[0]?.name).toBe('Dorian Fen')
  })

  // ADR 0008. Without this a resident who moved away or died got a blank
  // tick-box form on paper — an invitation to knock a door we already know not
  // to, on the one surface that cannot be corrected after it prints.
  it('prints the reason as the skip instruction, worded per reason', () => {
    const rows = walkListRows([
      stop({
        addresses: [
          household('105 Elm St', [
            target({ stopTargetId: 21, notAVoterReason: 'moved' }),
            target({
              stopTargetId: 22,
              personId: 'person-2',
              name: 'Marisol Vega',
              knockStatus: 'supporter',
              notAVoterReason: 'deceased',
            }),
          ]),
        ],
      }),
    ])

    expect(rows[0]?.answer).toEqual({
      kind: 'skip',
      instruction: 'Moved away — skip this resident',
    })
    // A death is read at a door the rest of the household still answers, so it
    // says what not to do rather than only what happened — and it outranks the
    // supporter answer logged there before.
    expect(rows[1]?.answer).toEqual({
      kind: 'skip',
      instruction:
        'Deceased — skip this resident, and do not ask for them by name',
    })
    expect(rows[1]?.name).toBe('Marisol Vega')
  })

  // Do-not-knock is an instruction about the door; a reason is a fact about one
  // of the people behind it.
  it('prints do-not-knock ahead of a reason when a resident carries both', () => {
    const rows = walkListRows([
      stop({
        addresses: [
          household('105 Elm St', [
            target({ doNotKnock: true, notAVoterReason: 'moved' }),
          ]),
        ],
      }),
    ])

    expect(rows[0]?.answer).toEqual({
      kind: 'skip',
      instruction: 'Do not knock — skip this door',
    })
  })

  it('carries household context under the address, not as a row of its own', () => {
    const rows = walkListRows([
      stop({
        addresses: [
          household(
            '105 Elm St',
            [target()],
            [{ name: 'Ruben Vega' }, { name: null }],
          ),
        ],
      }),
    ])

    expect(rows).toHaveLength(1)
    expect(rows[0]?.otherResidents).toEqual(['Ruben Vega'])
  })

  it('describes a resident with the age and party we have', () => {
    const rows = walkListRows([
      stop({
        addresses: [
          household('105 Elm St', [
            target({
              age: 68,
              politicalParty: 'Republican',
              mayHaveMoved: true,
            }),
          ]),
        ],
      }),
    ])

    expect(rows[0]?.meta).toBe('68 · Republican · may have moved')
  })

  it('names a resident the voter file has no name for', () => {
    const rows = walkListRows([
      stop({
        addresses: [
          household('105 Elm St', [
            target({ name: null, age: null, politicalParty: null }),
          ]),
        ],
      }),
    ])

    expect(rows[0]?.name).toBe('Name unavailable')
    expect(rows[0]?.meta).toBe('')
  })

  it('has no rows for a route with no stops', () => {
    expect(walkListRows([])).toEqual([])
  })

  // ENG-10876, the case the reviewer raised. `deriveKnockStatus` folds
  // answered-but-unsure into `unknown` so the door stays worth knocking, which
  // means it prints the identical blank form a never-knocked door does. The
  // line is the only thing on paper that tells the two apart.
  it('carries the last contact for a door whose status collapsed to unknown', () => {
    const rows = walkListRows([
      stop({
        addresses: [
          household('105 Elm St', [
            target({
              knockStatus: 'unknown',
              history: [doorKnock({ outcome: 'answered' })],
            }),
          ]),
        ],
      }),
    ])

    expect(rows[0]?.lastContact).toBe(
      'Last contact: June 2026 · Door knock: Answered',
    )
    // Still a blank form: unsure support is a door worth re-asking, and the
    // line is context rather than a reason to withhold the questions.
    expect(rows[0]?.answer).toEqual({ kind: 'form' })
  })

  it('names the channel for outreach that was not a knock', () => {
    const rows = walkListRows([
      stop({
        addresses: [
          household('105 Elm St', [
            target({
              stopTargetId: 21,
              history: [
                {
                  type: 'TEXT',
                  date: '2026-05-04T18:00:00.000Z',
                  data: {
                    activityId: 'tx-1',
                    respondedAt: null,
                    optedOutAt: null,
                    note: null,
                    manual: false,
                    outreachId: 412,
                  },
                },
              ],
            }),
            target({
              stopTargetId: 22,
              personId: 'person-2',
              history: [
                {
                  type: 'ROBOCALL',
                  date: '2026-04-04T18:00:00.000Z',
                  data: {
                    activityId: 'rc-1',
                    answeredAt: null,
                    voicemailLeftAt: null,
                    note: null,
                    manual: false,
                    outreachId: 412,
                  },
                },
              ],
            }),
          ]),
        ],
      }),
    ])

    expect(rows[0]?.lastContact).toBe('Last contact: May 2026 · Text')
    expect(rows[1]?.lastContact).toBe('Last contact: April 2026 · Robocall')
  })

  // A status change is a record edit, not an attempt to reach anyone — a flag
  // set at a desk or at a door. Counting it as contact would date the last
  // conversation to whenever somebody last corrected the file, and
  // `skipInstruction` already prints what a flag means for this resident.
  it('reads past a status change to the last actual contact', () => {
    const rows = walkListRows([
      stop({
        addresses: [
          household('105 Elm St', [
            target({
              history: [
                {
                  type: 'STATUS_CHANGE',
                  date: '2026-08-11T18:00:00.000Z',
                  data: {
                    activityId: 'se-1',
                    field: 'not_a_voter',
                    fromLabel: null,
                    toLabel: 'Moved away',
                    actorName: 'Rosa Iyer',
                    actorUserId: 77,
                    source: 'manual',
                  },
                },
                doorKnock({ outcome: 'not_home' }),
              ],
            }),
          ]),
        ],
      }),
    ])

    expect(rows[0]?.lastContact).toBe(
      'Last contact: June 2026 · Door knock: Not home',
    )
  })

  // Absence is not a claim: a route the service worker snapshotted before ADR
  // 0009 shipped carries no `history` key at all, so a printed "never
  // contacted" would be asserting something this payload cannot know.
  it('says nothing about a resident it was served no history for', () => {
    const rows = walkListRows([
      stop({
        addresses: [
          household('105 Elm St', [
            target({ stopTargetId: 21, history: [] }),
            target({ stopTargetId: 22, personId: 'person-2' }),
          ]),
        ],
      }),
    ])

    expect(rows[0]?.lastContact).toBeNull()
    expect(rows[1]?.lastContact).toBeNull()
  })

  // A note is free text about a named voter, on the surface that leaves the
  // building and stops being access-controlled when it does — the same rule
  // that keeps phone numbers off it. The fixture carries one so this asserts
  // the omission rather than trusting it.
  it('never carries a note onto paper', () => {
    const rows = walkListRows([
      stop({
        addresses: [
          household('105 Elm St', [
            target({
              history: [
                doorKnock({ note: 'Dog in the yard, come back Saturday' }),
              ],
            }),
          ]),
        ],
      }),
    ])

    expect(JSON.stringify(rows)).not.toMatch(/Dog in the yard/)
  })

  // ADR 0011's saved contact notes, and the same rule one level up: the knock
  // note above is one line attached to an event, while this is the resident's
  // whole written record. Asserted against the model rather than the page,
  // because the renderer structurally cannot print what it was never handed.
  // The fixture carries a note and a count of nine, so both halves can fail.
  it('never carries a saved contact note into the PDF model', () => {
    const rows = walkListRows([
      stop({ addresses: [household('105 Elm St', [target()])] }),
    ])

    const model = JSON.stringify(rows)
    expect(model).not.toMatch(/Do not ring the bell/)
    // The count is a disclosure of its own — "9 notes on file" says how much
    // has been written about this voter even with none of it printed.
    expect(model).not.toMatch(/"total"/)
    expect(model).not.toMatch(/019826f4/)
  })

  // Both paper surfaces render in Node, whose clock is UTC, so a door knocked
  // at 8:30pm Eastern belongs to the previous month by any US reckoning and to
  // this one by the renderer's. Formatting in UTC is what makes the sheet the
  // same on every machine that builds it — this date would name June if the
  // ambient timezone were allowed to decide.
  it('names the month in UTC rather than by the building machine', () => {
    const rows = walkListRows([
      stop({
        addresses: [
          household('105 Elm St', [
            target({
              history: [doorKnock({}, '2026-07-01T01:30:00.000Z')],
            }),
          ]),
        ],
      }),
    ])

    expect(rows[0]?.lastContact).toContain('July 2026')
  })
})

describe('walkListFilename', () => {
  it('slugifies the list name', () => {
    expect(walkListFilename('Elm & Cedar — Tuesday')).toBe(
      'elm-cedar-tuesday.pdf',
    )
  })

  it('falls back when the name slugifies to nothing', () => {
    expect(walkListFilename('!!!')).toBe('walk-list.pdf')
    expect(walkListFilename('')).toBe('walk-list.pdf')
  })

  // A truncated slug must not leave a trailing dash before the extension.
  it('truncates a long name without leaving a dangling separator', () => {
    const name = `${'a'.repeat(79)} ${'b'.repeat(20)}`

    expect(walkListFilename(name)).toBe(`${'a'.repeat(79)}.pdf`)
  })
})
