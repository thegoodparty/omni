import { describe, expect, it } from 'vitest'
import { renderUnitAddress } from './unitAddress.util'

// Keys as the people-db mirror builds them: UPPER(TRIM(COALESCE(col, ''))) per
// column, joined by '|'. Current format is ADDRESSLINE|APT|ZIP.
const key = (line: string, apartment = '', zip = '84101') =>
  [line, apartment, zip].join('|')

describe('renderUnitAddress', () => {
  // The address shapes this key has to survive. The two Utah rows are the
  // reported bug: on a grid the directions are most of the address, so a
  // renderer that drops them turns a findable corner into a pair of bare
  // numbers. The last two are the trap on the other side — a street whose name
  // is a direction word, where anything that strips or re-inserts directions by
  // pattern-matching single letters mangles a perfectly good address.
  it.each([
    ['a prefix directional', '1234 S MAIN ST', '1234 S MAIN ST'],
    ['a suffix directional', '1234 MAIN ST W', '1234 MAIN ST W'],
    ['both, the Utah grid case', '1234 S 5678 W', '1234 S 5678 W'],
    ['no directional at all', '1234 MAIN ST', '1234 MAIN ST'],
    ['a street named for a direction', '742 NORTH AVE', '742 NORTH AVE'],
    [
      'South Temple, Salt Lake City',
      '150 E SOUTH TEMPLE',
      '150 E SOUTH TEMPLE',
    ],
  ])('keeps %s intact', (_label, line, expected) => {
    expect(renderUnitAddress(key(line))).toBe(expected)
  })

  it('suffixes the apartment that makes the key a unit rather than a building', () => {
    expect(renderUnitAddress(key('1200 W ELM ST', '3B'))).toBe(
      '1200 W ELM ST Apt 3B',
    )
  })

  it('renders an all-empty key as empty, so the caller can fall back', () => {
    expect(renderUnitAddress(key('', '', ''))).toBe('')
  })

  // Routes frozen before the key switched still hold component-composed keys,
  // and a canvasser mid-list keeps reading them.
  describe('legacy component keys', () => {
    it('joins the components back in display order', () => {
      expect(renderUnitAddress('1200|W|ELM|ST||3B|62704')).toBe(
        '1200 W ELM ST Apt 3B',
      )
    })

    it('skips the empty segments rather than printing their gaps', () => {
      expect(renderUnitAddress('1204|W|ELM|ST|||62704')).toBe('1204 W ELM ST')
    })

    // Not an assertion that this is right — it is the defect, recorded. The two
    // direction columns are INTEGER in the mirror, so no legacy key ever
    // captured an 'S' or a 'W' and none can be recovered from one. Re-knocking
    // the list re-freezes it against the current key, which does carry them.
    it('cannot recover directions a legacy key never captured', () => {
      expect(renderUnitAddress('1234||5678||||84101')).toBe('1234 5678')
    })
  })

  it('falls back to the first segment of a household-era key', () => {
    expect(renderUnitAddress('1200 W ELM ST|SPRINGFIELD|IL|62704')).toBe(
      '1200 W ELM ST',
    )
  })

  it('returns a key it cannot parse unchanged', () => {
    expect(renderUnitAddress('1200 W ELM ST')).toBe('1200 W ELM ST')
  })
})
