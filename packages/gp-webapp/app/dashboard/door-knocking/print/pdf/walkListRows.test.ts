import { describe, expect, it } from 'vitest'
import { stop, target } from './walkListFixtures'
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

    expect(rows[0]?.answer).toEqual({ kind: 'skip' })
    // The name stays, so the grid still matches the app's stop numbering.
    expect(rows[0]?.name).toBe('Dorian Fen')
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
