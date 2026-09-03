import { describe, expect, it } from 'vitest'
import {
  renderDoorAddress,
  splitUnitAddress,
  streetLineOfStop,
  stripUnitFromLine,
} from './unitAddress.util'

// Keys as the people-db mirror builds them: UPPER(TRIM(COALESCE(col, ''))) per
// column, joined by '|'. Current format is ADDRESSLINE|APT|ZIP.
const key = (line: string, apartment = '', zip = '84101') =>
  [line, apartment, zip].join('|')

describe('renderDoorAddress', () => {
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
    expect(renderDoorAddress(key(line))).toBe(expected)
  })

  it('suffixes the apartment that makes the key a unit rather than a building', () => {
    expect(renderDoorAddress(key('1200 W ELM ST', '3B'))).toBe(
      '1200 W ELM ST Apt 3B',
    )
  })

  // The reported bug, and the reason any of the splitting exists. AddressLine
  // is the whole line as the file holds it, so the apartment is already in
  // there and appending ApartmentNum said it twice.
  it('says the apartment once when the line already carries it', () => {
    expect(renderDoorAddress(key('205 BENTON DR APT 8309', '8309'))).toBe(
      '205 BENTON DR Apt 8309',
    )
  })

  it('renders an all-empty key as empty, so the caller can fall back', () => {
    expect(renderDoorAddress(key('', '', ''))).toBe('')
  })

  describe('given the street line of the stop it hangs under', () => {
    // The reason a caller passes one at all: the key is uppercased by the
    // mirror, so a door would otherwise shout under the building it is part
    // of.
    it('prefers its casing when the two name one house', () => {
      expect(
        renderDoorAddress(
          key('205 BENTON DR APT 8309', '8309'),
          '205 Benton Dr',
        ),
      ).toBe('205 Benton Dr Apt 8309')
    })

    // A stop is a coordinate, and two street lines can geocode to one. Taking
    // the stop's line here would move this door to the house next door.
    it('keeps its own line when the two are different houses', () => {
      expect(renderDoorAddress(key('102 MAIN ST'), '100 Main St')).toBe(
        '102 MAIN ST',
      )
    })

    // A key with no street left in it still has a building over it.
    it('falls back to it when the key yields no street', () => {
      expect(renderDoorAddress(key('', '8309'), '205 Benton Dr')).toBe(
        '205 Benton Dr Apt 8309',
      )
    })
  })

  // Routes frozen before the key switched still hold component-composed keys,
  // and a canvasser mid-list keeps reading them.
  describe('legacy component keys', () => {
    it('joins the components back in display order', () => {
      expect(renderDoorAddress('1200|W|ELM|ST||3B|62704')).toBe(
        '1200 W ELM ST Apt 3B',
      )
    })

    it('skips the empty segments rather than printing their gaps', () => {
      expect(renderDoorAddress('1204|W|ELM|ST|||62704')).toBe('1204 W ELM ST')
    })

    // Not an assertion that this is right — it is the defect, recorded. The two
    // direction columns are INTEGER in the mirror, so no legacy key ever
    // captured an 'S' or a 'W' and none can be recovered from one. Re-knocking
    // the list re-freezes it against the current key, which does carry them.
    it('cannot recover directions a legacy key never captured', () => {
      expect(renderDoorAddress('1234||5678||||84101')).toBe('1234 5678')
    })
  })

  it('falls back to the first segment of a household-era key', () => {
    expect(renderDoorAddress('1200 W ELM ST|SPRINGFIELD|IL|62704')).toBe(
      '1200 W ELM ST',
    )
  })

  it('returns a key it cannot parse unchanged', () => {
    expect(renderDoorAddress('1200 W ELM ST')).toBe('1200 W ELM ST')
  })
})

describe('stripUnitFromLine', () => {
  // The designators a file actually writes in front of a unit, and the
  // punctuation it writes instead of one.
  it.each([
    ['a spelled designator', '205 BENTON DR APT 8309', '8309'],
    ['a hash', '205 BENTON DR #8309', '8309'],
    ['no designator at all', '205 BENTON DR 8309', '8309'],
    ['a suite', '400 MAIN ST STE 210', '210'],
    ['a letter unit', '1200 W ELM ST APT 3B', '3B'],
    ['lowercase in the file', '1200 W Elm St Apt 3B', '3B'],
  ])('takes the unit back off %s', (_label, line, apartment) => {
    expect(stripUnitFromLine(line, apartment)).not.toMatch(
      new RegExp(apartment, 'i'),
    )
  })

  it('leaves a line that never carried its unit alone', () => {
    expect(stripUnitFromLine('1200 W ELM ST', '3B')).toBe('1200 W ELM ST')
  })

  // The reason the apartment is required rather than the designator being
  // matched on its own: a trailing "<designator> <token>" also describes a
  // street, and guessing here would silently delete half of a real address.
  it('does not mistake a street for a unit', () => {
    expect(stripUnitFromLine('100 SAMPLE APT RD', '')).toBe('100 SAMPLE APT RD')
  })

  // A number that also opens the address is not the unit, because only a
  // trailing match counts.
  it('does not strip a house number that matches the apartment', () => {
    expect(stripUnitFromLine('8309 BENTON DR', '8309')).toBe('8309 BENTON DR')
  })

  // A line that was never more than its own unit: stripping leaves nothing, so
  // the caller keeps something to show rather than an empty row.
  it('keeps the line when the strip would empty it', () => {
    expect(stripUnitFromLine('APT 8309', '8309')).toBe('APT 8309')
  })
})

describe('splitUnitAddress', () => {
  it('separates the building from the door within it', () => {
    expect(splitUnitAddress(key('205 BENTON DR APT 8309', '8309'))).toEqual({
      line1: '205 BENTON DR',
      line2: 'Apt 8309',
    })
  })

  // The empty second line is the signal a house sends: nothing to tell apart,
  // so the walk list draws no door row for it.
  it('gives a house no second line', () => {
    expect(splitUnitAddress(key('608 FANNIN CT'))).toEqual({
      line1: '608 FANNIN CT',
      line2: '',
    })
  })

  it('splits a legacy key whose components never held the apartment', () => {
    expect(splitUnitAddress('1200|W|ELM|ST||3B|62704')).toEqual({
      line1: '1200 W ELM ST',
      line2: 'Apt 3B',
    })
  })

  it('reads a household-era key as a street line and no door', () => {
    expect(splitUnitAddress('1200 W ELM ST|SPRINGFIELD|IL|62704')).toEqual({
      line1: '1200 W ELM ST',
      line2: '',
    })
  })
})

describe('streetLineOfStop', () => {
  // The bug as the canvasser met it: one coordinate, several doors, and the
  // stop frozen under whichever resident sorted first — so a whole block of
  // flats was announced by one tenant's apartment number.
  it('names the building rather than whichever door was frozen on it', () => {
    expect(
      streetLineOfStop('205 Benton Dr Apt 13205', [
        key('205 BENTON DR APT 8309', '8309'),
        key('205 BENTON DR APT 13205', '13205'),
      ]),
    ).toBe('205 Benton Dr')
  })

  // Reduced over the doors, so the order they arrive in cannot change the
  // answer: only the apartment that is actually on the line matches.
  it('does not depend on which door is checked first', () => {
    expect(
      streetLineOfStop('205 Benton Dr Apt 8309', [
        key('205 BENTON DR APT 8309', '8309'),
        key('205 BENTON DR APT 13205', '13205'),
      ]),
    ).toBe('205 Benton Dr')
  })

  // Keeps the frozen line's casing, which is the whole reason the stop's line
  // is cleaned instead of the key's own being rendered: the mirror uppercases
  // every key, and a stop shouting over the doors beneath it is a regression
  // of its own.
  it('keeps the casing the route was frozen with', () => {
    expect(
      streetLineOfStop('1200 W Elm St Apt 3B', [key('1200 W ELM ST', '3B')]),
    ).toBe('1200 W Elm St')
  })

  it('leaves a house untouched', () => {
    expect(streetLineOfStop('608 Fannin Ct', [key('608 FANNIN CT')])).toBe(
      '608 Fannin Ct',
    )
  })
})
