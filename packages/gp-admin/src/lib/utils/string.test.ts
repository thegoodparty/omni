import { describe, it, expect } from 'vitest'
import { formatKeyAsLabel, truncateMiddle } from './string'

describe('formatKeyAsLabel', () => {
  it('converts camelCase keys to readable labels', () => {
    expect(formatKeyAsLabel('firstName')).toBe('First Name')
    expect(formatKeyAsLabel('userPhoneNumber')).toBe('User Phone Number')
  })

  it('capitalizes single words', () => {
    expect(formatKeyAsLabel('name')).toBe('Name')
  })

  it('handles already capitalized input', () => {
    expect(formatKeyAsLabel('FirstName')).toBe('First Name')
  })

  it('handles edge cases', () => {
    expect(formatKeyAsLabel('a')).toBe('A')
    expect(formatKeyAsLabel('')).toBe('')
    expect(formatKeyAsLabel('ABC')).toBe('A B C')
  })
})

describe('truncateMiddle', () => {
  it('shortens a uuid to the max length with an ellipsis in the middle', () => {
    expect(truncateMiddle('af726827-f099-4385-934e-36d00c2d540e')).toBe(
      'af726…540e'
    )
  })

  it('keeps the head and the tail, which are what a reader compares', () => {
    const truncated = truncateMiddle('4e23d0cf-a40b-4ce5-9bb6-0a67d9551a89')

    expect(truncated.startsWith('4e23d')).toBe(true)
    expect(truncated.endsWith('1a89')).toBe(true)
  })

  it('leaves a value that already fits alone', () => {
    expect(truncateMiddle('short-id')).toBe('short-id')
    expect(truncateMiddle('0123456789')).toBe('0123456789')
  })

  it('never returns more than the max length', () => {
    for (const maxLength of [3, 6, 10, 42]) {
      expect(
        truncateMiddle('af726827-f099-4385-934e-36d00c2d540e', maxLength).length
      ).toBeLessThanOrEqual(maxLength)
    }
  })
})
