import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { COVERAGE_COPY, verdictFor } from './verdict'
import { lineageOf } from './lineage'
import { data, nextRun } from './data'
import type { EventRecord } from './data'

/**
 * The two copies of this page share no code, so "every change lands in both" was a rule
 * with nothing enforcing it — and they had already drifted in four places, including a
 * retired verdict that dropped the successor's name on the copy people actually use.
 * Every sentence a reader sees has to exist in both, so assert it.
 */
const template = readFileSync(
  join(__dirname, '..', 'standalone', 'template.html'),
  'utf8',
)

// The standalone builds its sentences by concatenation, so an interpolated verdict is
// checked by its literal fragments rather than the assembled string.
const STATUSES = [
  'active',
  'dormant',
  'deprecating',
  'orphaned_firing',
  'retired',
  'instrumented_never_observed',
  'code_unknown',
  'system',
]

const fixture = (status: string, supersession = ''): EventRecord =>
  ({
    status,
    supersession,
    count_30d: 1,
    last_seen: '2026-09-23',
    provenance: { retired_date: '2026-09-01' },
  }) as unknown as EventRecord

/** The parts of a sentence that survive concatenation: no numbers, no dates. */
const fragments = (sentence: string) =>
  sentence
    .split(/\b[\d,]+\b|[A-Z][a-z]{2} \d{1,2}/)
    .map((part) => part.trim())
    .filter((part) => part.length > 12)

describe('the two copies of the page say the same things', () => {
  for (const status of STATUSES) {
    it(`the ${status} verdict matches`, () => {
      for (const part of fragments(verdictFor(fixture(status)).sentence)) {
        expect(template, `missing from the standalone: "${part}"`).toContain(
          part,
        )
      }
    })
  }

  // The registry's real shape, not a clean name: a fixture of "Voter Data - X" passes
  // whether or not the prose is parsed, so it proved nothing about the broken path.
  const PROSE =
    'superseded by Voter Data - List Exported (the CRM lists flow replaced it)'

  it('a superseded event names its successor in both', () => {
    expect(template).toContain('and replaced by ')
  })

  it('never reads "replaced by superseded by"', () => {
    const sentence = verdictFor(fixture('retired', PROSE)).sentence
    expect(sentence).not.toContain('replaced by superseded by')
    expect(sentence).not.toContain('(')
  })

  // A fixture is not in the snapshot, so its prose can never resolve and the assertion
  // above passes even if resolution is broken. This one takes a real retired event and
  // asserts the successor's name reaches the sentence.
  it('names the successor of a real retired event', () => {
    const real = data.events.find(
      (e) => e.status === 'retired' && lineageOf(e).replacedBy,
    )
    expect(
      real,
      'no retired event resolves a successor in the snapshot',
    ).toBeTruthy()
    const sentence = verdictFor(real as EventRecord).sentence
    expect(sentence).toContain(
      (lineageOf(real as EventRecord).replacedBy as EventRecord).display_name,
    )
    expect(sentence).not.toContain('superseded by')
  })
})

describe('nextRun states when the page actually moves', () => {
  // Noon UTC, Mondays and Thursdays: the republish, an hour after the pipeline. A
  // one-character slip in the `<=` or in the [1, 4] literal shows a wrong time in the
  // header, which is the one thing the page promises about its own freshness.
  const at = (iso: string) => nextRun(new Date(iso)).toISOString()

  it('before noon on a run day, later the same day', () => {
    expect(at('2026-09-28T09:00:00Z')).toBe('2026-09-28T12:00:00.000Z')
  })

  it('exactly at noon, the next run day', () => {
    expect(at('2026-09-28T12:00:00Z')).toBe('2026-10-01T12:00:00.000Z')
  })

  it('after noon on Thursday, the following Monday', () => {
    expect(at('2026-10-01T15:00:00Z')).toBe('2026-10-05T12:00:00.000Z')
  })

  it('on a day between runs, the next run day', () => {
    expect(at('2026-09-30T08:00:00Z')).toBe('2026-10-01T12:00:00.000Z')
  })

  // These cases exercise data.ts; the standalone has its own copy of the function that
  // no test here can call. Assert the shape that matters instead: one instant, taken
  // once, or the comparison can straddle the boundary it is testing for.
  it('the standalone compares against a single captured instant', () => {
    const start = template.indexOf('function nextRun()')
    // to the function's own closing brace, not a fixed window: a loose slice reaches
    // into the next function and counts its clocks too
    // comments stripped: the first version of this assertion was defeated by a comment
    // that mentioned the very call it was counting
    const fn = template
      .slice(start, template.indexOf('\n    }', start))
      .replace(/\/\/.*$/gm, '')
    expect(fn).toContain('d <= now')
    expect(fn.match(/new Date\(\)/g) ?? []).toHaveLength(1)
    expect(fn).toContain('setUTCHours(12, 0, 0, 0)')
    expect(fn).toContain('[1, 4]')
  })

  for (const [key, copy] of Object.entries(COVERAGE_COPY)) {
    it(`the ${key} coverage blurb matches`, () => {
      expect(template).toContain(copy.blurb)
      expect(template).toContain(copy.label)
    })
  }
})
