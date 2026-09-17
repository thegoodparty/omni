import { describe, expect, it } from 'vitest'
import { entry, interaction, person } from './callSheetFixtures'
import {
  callSheetFilename,
  callSheetRows,
  callSheetZipFilename,
  sheetIndexesOf,
} from './callSheetRows'

describe('callSheetRows', () => {
  it('emits one row per phone number, in seq order', () => {
    const rows = callSheetRows([
      entry({ id: 2, seq: 2, phone: '(312) 555-0102' }),
      entry({ id: 1, seq: 1, phone: '(312) 555-0101' }),
    ])

    expect(rows.map((row) => [row.seq, row.phone])).toEqual([
      [1, '(312) 555-0101'],
      [2, '(312) 555-0102'],
    ])
  })

  // A 2-person number renders one row with both names and stacked per-person
  // Support/Notes cells — not one row per resident, unlike the walk list.
  it('stacks every named resident on a shared number inside one row', () => {
    const rows = callSheetRows([
      entry({
        persons: [
          person({ personId: 'person-1', name: 'Dorian Fen' }),
          person({ personId: 'person-2', name: 'Marisol Vega' }),
        ],
      }),
    ])

    expect(rows).toHaveLength(1)
    expect(rows[0]?.persons.map((p) => p.name)).toEqual([
      'Dorian Fen',
      'Marisol Vega',
    ])
  })

  it('has no rows for a list with no entries', () => {
    expect(callSheetRows([])).toEqual([])
  })

  // A number nobody has called yet gets the blank tick-box form.
  it('prints a blank form for a number with no interaction', () => {
    const rows = callSheetRows([entry({ persons: [person()] })])

    expect(rows[0]?.outcome).toEqual({ kind: 'form' })
    expect(rows[0]?.persons[0]?.support).toEqual({ kind: 'form' })
  })

  // Answered / no answer / voicemail are informational: a callback may still
  // be worthwhile, so the outcome prints as a recorded state rather than an
  // instruction to stop trying.
  it.each([
    ['answered', 'Answered'],
    ['no_answer', 'No answer'],
    ['voicemail', 'Voicemail'],
  ] as const)('prints a logged outcome for %s', (outcome, label) => {
    const rows = callSheetRows([
      entry({
        persons: [person({ interaction: interaction({ outcome }) })],
      }),
    ])

    expect(rows[0]?.outcome).toEqual({ kind: 'logged', label })
  })

  // A wrong number or a refusal is a dead end: nobody at that number is worth
  // calling again, so the row carries an instruction instead of a recorded
  // outcome — the same "nothing left to ask" shape the walk list's skip is.
  it.each([
    ['wrong_number', 'Wrong number — do not call again'],
    ['refused', 'Refused — do not call again'],
  ] as const)('prints a skip instruction for %s', (outcome, expected) => {
    const rows = callSheetRows([
      entry({
        persons: [person({ interaction: interaction({ outcome }) })],
      }),
    ])

    expect(rows[0]?.outcome).toEqual({ kind: 'skip', instruction: expected })
  })

  it('prints the recorded support answer instead of a blank form', () => {
    const rows = callSheetRows([
      entry({
        persons: [
          person({
            interaction: interaction({
              outcome: 'answered',
              supportAnswer: 'supporter',
            }),
          }),
        ],
      }),
    ])

    expect(rows[0]?.persons[0]?.support).toEqual({
      kind: 'logged',
      label: 'Yes',
    })
  })

  // A call that connected but hasn't recorded this person's opinion yet
  // still gets a blank Support form — the outcome and the support answer
  // are independent facts.
  it('leaves the support form blank for a logged outcome nobody answered support for', () => {
    const rows = callSheetRows([
      entry({
        persons: [
          person({ interaction: interaction({ outcome: 'voicemail' }) }),
        ],
      }),
    ])

    expect(rows[0]?.outcome).toEqual({ kind: 'logged', label: 'Voicemail' })
    expect(rows[0]?.persons[0]?.support).toEqual({ kind: 'form' })
  })

  // Nothing to ask a person at a number that's already a dead end — the row's
  // skip instruction replaces every person's Support form, not just the
  // shared outcome cell.
  it('propagates the skip instruction to every person on a dead-end row', () => {
    const rows = callSheetRows([
      entry({
        persons: [
          person({
            personId: 'person-1',
            interaction: interaction({ outcome: 'wrong_number' }),
          }),
          person({ personId: 'person-2', name: 'Marisol Vega' }),
        ],
      }),
    ])

    const expected = {
      kind: 'skip',
      instruction: 'Wrong number — do not call again',
    }
    expect(rows[0]?.persons[0]?.support).toEqual(expected)
    expect(rows[0]?.persons[1]?.support).toEqual(expected)
  })

  // A call reaches the whole household at once, so persons on the same entry
  // are expected to share an outcome; the row takes whichever interaction it
  // finds first as representative.
  it('takes the first recorded interaction as the row outcome', () => {
    const rows = callSheetRows([
      entry({
        persons: [
          person({
            personId: 'person-1',
            interaction: interaction({ outcome: 'answered' }),
          }),
          person({ personId: 'person-2', interaction: null }),
        ],
      }),
    ])

    expect(rows[0]?.outcome).toEqual({ kind: 'logged', label: 'Answered' })
  })

  // sheetIndex is per-entry from the build (Math.ceil(seq / 60)); the 60/61
  // boundary is where a second sheet starts.
  it('reports the distinct sheet numbers present at the 60/61 boundary', () => {
    const entries = Array.from({ length: 61 }, (_, i) =>
      entry({
        id: i + 1,
        seq: i + 1,
        sheetIndex: Math.ceil((i + 1) / 60),
        phone: `(312) 555-${String(i).padStart(4, '0')}`,
      }),
    )
    const rows = callSheetRows(entries)

    expect(sheetIndexesOf(rows)).toEqual([1, 2])
    expect(rows.filter((row) => row.sheetIndex === 1)).toHaveLength(60)
    expect(rows.filter((row) => row.sheetIndex === 2)).toHaveLength(1)
  })

  it('reports one sheet number for a list with no second sheet', () => {
    const rows = callSheetRows([entry({ sheetIndex: 1 })])

    expect(sheetIndexesOf(rows)).toEqual([1])
  })
})

describe('callSheetFilename', () => {
  const now = new Date('2026-08-19T12:00:00.000Z')

  it('slugifies the list name and carries the sheet position and date', () => {
    expect(callSheetFilename('Elm & Cedar — Tuesday', 2, 3, now)).toBe(
      'elm-cedar-tuesday---phone-bank---08-19-2026-list-2-of-3.pdf',
    )
  })

  it('falls back when the name slugifies to nothing', () => {
    expect(callSheetFilename('!!!', 1, 1, now)).toBe(
      'call-sheet---phone-bank---08-19-2026-list-1-of-1.pdf',
    )
    expect(callSheetFilename('', 1, 1, now)).toBe(
      'call-sheet---phone-bank---08-19-2026-list-1-of-1.pdf',
    )
  })

  // A truncated slug must not leave a trailing dash before the separator.
  it('truncates a long name without leaving a dangling separator', () => {
    const name = `${'a'.repeat(79)} ${'b'.repeat(20)}`

    expect(callSheetFilename(name, 1, 1, now)).toBe(
      `${'a'.repeat(79)}---phone-bank---08-19-2026-list-1-of-1.pdf`,
    )
  })

  // Both paper surfaces render in Node, whose clock is UTC — formatting in
  // UTC is what keeps the filename identical off any machine that builds it.
  it('formats the date in UTC rather than by the building machine', () => {
    expect(
      callSheetFilename(
        'Elm & Cedar',
        1,
        1,
        new Date('2026-07-01T01:30:00.000Z'),
      ),
    ).toContain('07-01-2026')
  })
})

describe('callSheetZipFilename', () => {
  it('names the bundle after the list and the date, with no sheet segment', () => {
    expect(
      callSheetZipFilename('Elm & Cedar', new Date('2026-08-19T12:00:00.000Z')),
    ).toBe('elm-cedar---phone-bank---08-19-2026.zip')
  })
})
