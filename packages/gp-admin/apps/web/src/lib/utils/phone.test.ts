import { describe, it, expect } from 'vitest'
import { formatPhone } from './phone'

describe('formatPhone', () => {
  it('should format a valid US phone number', () => {
    expect(formatPhone('2025551234')).toBe('(202) 555-1234')
  })

  it('should format a phone number with country code', () => {
    expect(formatPhone('+12025551234')).toBe('(202) 555-1234')
  })

  it('should return em-dash for null', () => {
    expect(formatPhone(null)).toBe('—')
  })

  it('should return em-dash for undefined', () => {
    expect(formatPhone(undefined)).toBe('—')
  })

  it('should return em-dash for empty string', () => {
    expect(formatPhone('')).toBe('—')
  })

  it('should return original string for invalid phone number', () => {
    expect(formatPhone('invalid')).toBe('invalid')
  })

  it('should handle phone number with formatting', () => {
    expect(formatPhone('202-555-1234')).toBe('(202) 555-1234')
  })
})
