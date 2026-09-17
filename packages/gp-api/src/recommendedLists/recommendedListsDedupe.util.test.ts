import { describe, expect, it } from 'vitest'
import { findEquivalentFilter } from './recommendedListsDedupe.util'

describe('findEquivalentFilter', () => {
  it('treats null and false as the same absent dimension', () => {
    const saved = [{ id: 1, hasCellPhone: true, partyDemocrat: false }]
    const candidate = { hasCellPhone: true, partyDemocrat: null }
    expect(findEquivalentFilter(candidate, saved)).toBe(1)
  })

  it('ignores array order', () => {
    const saved = [{ id: 2, voterStatus: ['Likely', 'Super'] }]
    const candidate = { voterStatus: ['Super', 'Likely'] }
    expect(findEquivalentFilter(candidate, saved)).toBe(2)
  })

  it('ignores name and timestamps', () => {
    const saved = [
      {
        id: 3,
        name: 'My list',
        createdAt: new Date(),
        voterStatus: ['Super'],
      },
    ]
    expect(findEquivalentFilter({ voterStatus: ['Super'] }, saved)).toBe(3)
  })

  it('distinguishes filters differing in one dimension', () => {
    const saved = [{ id: 4, voterStatus: ['Super'] }]
    const candidate = { voterStatus: ['Super'], hasCellPhone: true }
    expect(findEquivalentFilter(candidate, saved)).toBeNull()
  })

  it('compares support status off the row', () => {
    const saved = [{ id: 5, supportStatus: ['supporter'] }]
    expect(findEquivalentFilter({ supportStatus: ['supporter'] }, saved)).toBe(
      5,
    )
    expect(
      findEquivalentFilter({ supportStatus: ['undecided'] }, saved),
    ).toBeNull()
  })

  it('distinguishes filters differing only in precincts', () => {
    const saved = [{ id: 6, precincts: ['Adams|001'] }]
    const candidate = { precincts: ['Adams|001', 'Adams|002'] }
    expect(findEquivalentFilter(candidate, saved)).toBeNull()
  })

  it('returns null against an empty saved set', () => {
    expect(findEquivalentFilter({ voterStatus: ['Super'] }, [])).toBeNull()
  })

  it('treats an unset contacts-made bucket as false, off the payload', () => {
    const saved = [{ id: 7, hasCellPhone: true, contactsMade0: false }]
    const candidate = { hasCellPhone: true }
    expect(findEquivalentFilter(candidate, saved)).toBe(7)
  })

  it('distinguishes filters differing only in contacts-made', () => {
    const saved = [{ id: 8, hasCellPhone: true, contactsMade0: true }]
    const candidate = { hasCellPhone: true }
    expect(findEquivalentFilter(candidate, saved)).toBeNull()
  })

  it('ignores activity-condition action order within a condition', () => {
    const saved = [
      {
        id: 9,
        activityConditions: [
          {
            outreachType: 'text',
            outreachId: 1,
            actions: ['responded', 'opted_out'],
          },
        ],
      },
    ]
    const candidate = {
      activityConditions: [
        {
          outreachType: 'text',
          outreachId: 1,
          actions: ['opted_out', 'responded'],
        },
      ],
    }
    expect(findEquivalentFilter(candidate, saved)).toBe(9)
  })

  it('distinguishes filters differing only in activity conditions', () => {
    const saved = [
      {
        id: 10,
        activityConditions: [
          { outreachType: 'text', outreachId: 1, actions: ['responded'] },
        ],
      },
    ]
    const candidate = {
      activityConditions: [
        { outreachType: 'text', outreachId: 2, actions: ['responded'] },
      ],
    }
    expect(findEquivalentFilter(candidate, saved)).toBeNull()
  })
})
