import { describe, it, expect } from 'vitest'
import { formatKeyAsLabel } from './string'

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
