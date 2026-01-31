import { describe, it, expect } from 'vitest'
import { formatKeyAsLabel } from './string'

describe('formatKeyAsLabel', () => {
  it('should convert camelCase to Title Case', () => {
    expect(formatKeyAsLabel('firstName')).toBe('First Name')
  })

  it('should convert simple lowercase to capitalized', () => {
    expect(formatKeyAsLabel('name')).toBe('Name')
  })

  it('should handle multiple capital letters', () => {
    expect(formatKeyAsLabel('userPhoneNumber')).toBe('User Phone Number')
  })

  it('should handle already capitalized first letter', () => {
    expect(formatKeyAsLabel('FirstName')).toBe('First Name')
  })

  it('should handle single letter', () => {
    expect(formatKeyAsLabel('a')).toBe('A')
  })

  it('should handle empty string', () => {
    expect(formatKeyAsLabel('')).toBe('')
  })

  it('should handle all uppercase', () => {
    expect(formatKeyAsLabel('ABC')).toBe('A B C')
  })
})
