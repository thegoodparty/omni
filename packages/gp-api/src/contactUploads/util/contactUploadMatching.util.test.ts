import { describe, expect, it } from 'vitest'
import { ContactUploadMatchMethod } from '@/generated/prisma'
import {
  addressParts,
  decideFromCandidates,
  nameKey,
} from './contactUploadMatching.util'

const candidate = (
  personId: string,
  phoneAgrees: boolean,
  addressAgrees: boolean,
  nameCount: number,
) => ({ rowIndex: 0, personId, phoneAgrees, addressAgrees, nameCount })

describe('nameKey', () => {
  it('keeps lowercase letters only', () => {
    expect(nameKey("O'Brien-Smith ")).toBe('obriensmith')
    expect(nameKey(null)).toBe('')
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
  it('is new when nobody shares the name', () => {
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

  it('asks when two or more agree, listing the agreeing ones', () => {
    expect(
      decideFromCandidates([
        candidate('a', true, false, 3),
        candidate('b', false, true, 3),
        candidate('c', false, false, 3),
      ]),
    ).toMatchObject({
      outcome: 'needs_input',
      personId: null,
      candidatePersonIds: ['a', 'b'],
      suggestedPersonId: null,
    })
  })

  it('suggests the lone person sharing the name when nothing else agrees', () => {
    expect(decideFromCandidates([candidate('a', false, false, 1)])).toEqual({
      outcome: 'needs_input',
      method: null,
      personId: null,
      isNewPerson: false,
      candidatePersonIds: ['a'],
      suggestedPersonId: 'a',
    })
  })

  it('lists everyone sharing the name when several do and none agree', () => {
    expect(
      decideFromCandidates([
        candidate('a', false, false, 12),
        candidate('b', false, false, 12),
      ]),
    ).toMatchObject({
      outcome: 'needs_input',
      candidatePersonIds: ['a', 'b'],
      suggestedPersonId: null,
    })
  })
})
