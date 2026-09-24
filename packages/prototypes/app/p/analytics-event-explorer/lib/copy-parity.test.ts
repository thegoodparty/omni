import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { COVERAGE_COPY, verdictFor } from './verdict'
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

  it('a superseded event names its successor in both', () => {
    const sentence = verdictFor(fixture('retired', 'Voter Data - X')).sentence
    expect(sentence).toContain('replaced by')
    expect(template).toContain('and replaced by ')
  })

  for (const [key, copy] of Object.entries(COVERAGE_COPY)) {
    it(`the ${key} coverage blurb matches`, () => {
      expect(template).toContain(copy.blurb)
      expect(template).toContain(copy.label)
    })
  }
})
