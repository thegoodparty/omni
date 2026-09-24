import { describe, expect, it } from 'vitest'
import { VALUE_MAPPERS } from './valueMappers.util'

describe('VALUE_MAPPERS', () => {
  it('maps every wire value to the value the voter file stores', () => {
    expect(VALUE_MAPPERS.ethnicity('Asian')).toBe('East and South Asian')
    expect(VALUE_MAPPERS.ethnicity('African American')).toBe(
      'Likely African-American',
    )
    expect(VALUE_MAPPERS.presenceOfChildren('Yes')).toBe('Y')
    expect(VALUE_MAPPERS.presenceOfChildren('No')).toBe('N')
    expect(VALUE_MAPPERS.educationLevel('Graduate Degree')).toBe(
      'Completed Graduate School Likely',
    )
    expect(VALUE_MAPPERS.maritalStatus('Inferred Married')).toBe(
      'Inferred Married',
    )
  })

  // ENG-10947: the product taxonomy collapsed Yes/Likely into one Homeowner
  // bucket, so the pill has to match both stored values. 'Likely' survives
  // unfolded only for filters saved before the collapse.
  it('folds Probable Home Owner into the Homeowner selection', () => {
    expect(VALUE_MAPPERS.homeowner('Yes')).toEqual([
      'Home Owner',
      'Probable Home Owner',
    ])
    expect(VALUE_MAPPERS.homeowner('Likely')).toBe('Probable Home Owner')
    expect(VALUE_MAPPERS.homeowner('No')).toBe('Renter')
  })

  // null is "no value stored", which is a different query than matching a
  // value — a mapper that returned the string 'Unknown' would filter for a
  // literal that is not in the file.
  it('maps Unknown to null for every dimension', () => {
    for (const mapper of Object.values(VALUE_MAPPERS)) {
      expect(mapper('Unknown')).toBeNull()
    }
  })

  // Presence-only: the column holds a value meaning yes or nothing at all,
  // so there is no 'No' to map.
  it('passes an unrecognized value through unchanged', () => {
    expect(VALUE_MAPPERS.veteranStatus('Yes')).toBe('Yes')
    expect(VALUE_MAPPERS.ethnicity('Klingon')).toBe('Klingon')
    expect(VALUE_MAPPERS.gender('X')).toBe('X')
  })
})
