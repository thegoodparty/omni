import { describe, it, expect } from 'vitest'
import { formatPhone } from './phone'

describe('formatPhone', () => {
  it('formats US phone numbers as (XXX) XXX-XXXX', () => {
    expect(formatPhone('2025551234')).toBe('(202) 555-1234')
  })

  it('handles phone numbers with country code', () => {
    expect(formatPhone('+12025551234')).toBe('(202) 555-1234')
  })

  it('handles phone numbers with existing formatting', () => {
    expect(formatPhone('202-555-1234')).toBe('(202) 555-1234')
  })

  it('shows em-dash when phone is missing', () => {
    expect(formatPhone(null)).toBe('—')
    expect(formatPhone(undefined)).toBe('—')
    expect(formatPhone('')).toBe('—')
  })

  it('preserves invalid phone numbers as-is', () => {
    expect(formatPhone('invalid')).toBe('invalid')
  })
})
