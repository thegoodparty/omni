import { describe, expect, it } from 'vitest'
import { ContactUploadMatchMethod } from '@/generated/prisma'
import type { FirstNameMatch } from '@/peopleDb/databricks/contactUploadMatchSql.util'
import {
  addressParts,
  decideFromCandidates,
  firstNameAliases,
  nameKey,
} from './contactUploadMatching.util'

const candidate = (
  personId: string,
  phoneAgrees: boolean,
  addressAgrees: boolean,
  candidateCount: number,
  firstNameMatch: FirstNameMatch = 'exact',
) => ({
  rowIndex: 0,
  personId,
  firstNameMatch,
  phoneAgrees,
  addressAgrees,
  candidateCount,
})

describe('nameKey', () => {
  it('keeps lowercase letters only', () => {
    expect(nameKey("O'Brien-Smith ")).toBe('obriensmith')
    expect(nameKey(null)).toBe('')
  })
})

describe('firstNameAliases', () => {
  it('reaches the full name from a nickname, and its other nicknames', () => {
    expect(firstNameAliases('bob')).toEqual(
      expect.arrayContaining(['bob', 'robert', 'rob', 'bobby']),
    )
  })

  it('reaches the nicknames from the full name', () => {
    expect(firstNameAliases('robert')).toEqual(
      expect.arrayContaining(['robert', 'bob', 'rob']),
    )
  })

  it('reaches a listed variant spelling', () => {
    expect(firstNameAliases('jonathon')).toContain('jonathan')
  })

  it('is the name alone when the list does not have it', () => {
    expect(firstNameAliases('zzyzx')).toEqual(['zzyzx'])
  })

  it('does not alias unrelated names', () => {
    expect(firstNameAliases('john')).not.toContain('joan')
  })
})

describe('addressParts', () => {
  it.each([
    ['123 Oak St', { house: '123', streetKey: 'oak' }],
    ['123 N Oak Street Apt 4', { house: '123', streetKey: 'oak' }],
    ['123A Main', { house: '123', streetKey: 'main' }],
    ['PO Box 5', { house: null, streetKey: null }],
    [null, { house: null, streetKey: null }],
  ])('%s', (input, expected) => {
    expect(addressParts(input)).toEqual(expected)
  })
})

describe('decideFromCandidates', () => {
  it('is new when nobody is a candidate', () => {
    expect(decideFromCandidates([])).toBeNull()
  })

  it('matches the one candidate agreeing on phone', () => {
    expect(
      decideFromCandidates([
        candidate('a', true, false, 2),
        candidate('b', false, false, 2),
      ]),
    ).toMatchObject({
      outcome: 'matched',
      method: ContactUploadMatchMethod.name_and_phone,
      personId: 'a',
    })
  })

  it('matches the one candidate agreeing on address', () => {
    expect(
      decideFromCandidates([candidate('a', false, true, 1)]),
    ).toMatchObject({
      outcome: 'matched',
      method: ContactUploadMatchMethod.name_and_address,
      personId: 'a',
    })
  })

  it.each<[string, FirstNameMatch]>([
    ['john against johnathan (prefix)', 'prefix'],
    ['bob against robert (alias)', 'alias'],
    ['jonathon against jonathan (alias)', 'alias'],
  ])('matches %s with the same phone', (_, firstNameMatch) => {
    expect(
      decideFromCandidates([candidate('a', true, false, 1, firstNameMatch)]),
    ).toMatchObject({
      outcome: 'matched',
      method: ContactUploadMatchMethod.name_and_phone,
      personId: 'a',
    })
  })

  it('never matches a typo, even agreeing on phone and address (john against joan)', () => {
    expect(
      decideFromCandidates([candidate('a', true, true, 1, 'typo')]),
    ).toEqual({
      outcome: 'needs_input',
      method: null,
      personId: null,
      isNewPerson: false,
      candidatePersonIds: ['a'],
      suggestedPersonId: null,
    })
  })

  it('does not match a nickname on the name alone', () => {
    expect(
      decideFromCandidates([candidate('a', false, false, 1, 'alias')]),
    ).toMatchObject({
      outcome: 'needs_input',
      candidatePersonIds: ['a'],
      suggestedPersonId: null,
    })
  })

  it('matches the candidate agreeing on both phone and address over one agreeing on phone', () => {
    expect(
      decideFromCandidates([
        candidate('a', true, false, 2),
        candidate('b', true, true, 2),
      ]),
    ).toMatchObject({
      outcome: 'matched',
      method: ContactUploadMatchMethod.name_and_phone,
      personId: 'b',
    })
  })

  it('matches the exact name over a nickname agreeing on the same phone', () => {
    expect(
      decideFromCandidates([
        candidate('a', true, false, 2, 'alias'),
        candidate('b', true, false, 2, 'exact'),
      ]),
    ).toMatchObject({ outcome: 'matched', personId: 'b' })
  })

  it('matches a nickname agreeing on phone over an exact name agreeing on nothing', () => {
    expect(
      decideFromCandidates([
        candidate('a', false, false, 2, 'exact'),
        candidate('b', true, false, 2, 'alias'),
      ]),
    ).toMatchObject({ outcome: 'matched', personId: 'b' })
  })

  it('asks when a typo outscores the strongest candidate that could match', () => {
    expect(
      decideFromCandidates([
        candidate('a', true, false, 2, 'alias'),
        candidate('b', true, true, 2, 'typo'),
      ]),
    ).toMatchObject({
      outcome: 'needs_input',
      candidatePersonIds: ['b', 'a'],
    })
  })

  it('asks on a tie, listing every candidate by score', () => {
    expect(
      decideFromCandidates([
        candidate('c', false, false, 3),
        candidate('b', false, true, 3),
        candidate('a', true, false, 3),
      ]),
    ).toMatchObject({
      outcome: 'needs_input',
      personId: null,
      candidatePersonIds: ['a', 'b', 'c'],
      suggestedPersonId: null,
    })
  })

  it('suggests the lone candidate sharing the exact name when nothing else agrees', () => {
    expect(decideFromCandidates([candidate('a', false, false, 1)])).toEqual({
      outcome: 'needs_input',
      method: null,
      personId: null,
      isNewPerson: false,
      candidatePersonIds: ['a'],
      suggestedPersonId: 'a',
    })
  })

  it('lists everyone when several share the name and none agree', () => {
    expect(
      decideFromCandidates([
        candidate('b', false, false, 12),
        candidate('a', false, false, 12),
      ]),
    ).toMatchObject({
      outcome: 'needs_input',
      candidatePersonIds: ['a', 'b'],
      suggestedPersonId: null,
    })
  })
})
