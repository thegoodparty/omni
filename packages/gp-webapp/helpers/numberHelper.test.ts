import { describe, it, expect } from 'vitest'
import {
  numberNth,
  kFormatter,
  formatPhoneNumber,
  formatDisplayPhoneNumber,
} from './numberHelper'

describe('numberNth', () => {
  it('appends the correct ordinal suffix to single digits', () => {
    expect(numberNth(1)).toBe('1st')
    expect(numberNth(2)).toBe('2nd')
    expect(numberNth(3)).toBe('3rd')
    expect(numberNth(4)).toBe('4th')
  })

  it('uses "th" for the 11-13 teens exception', () => {
    expect(numberNth(11)).toBe('11th')
    expect(numberNth(12)).toBe('12th')
    expect(numberNth(13)).toBe('13th')
  })

  it('appends the correct suffix beyond the teens', () => {
    expect(numberNth(21)).toBe('21st')
    expect(numberNth(22)).toBe('22nd')
    expect(numberNth(23)).toBe('23rd')
    expect(numberNth(111)).toBe('111th')
  })

  it('parses string input as an integer', () => {
    expect(numberNth('5')).toBe('5th')
    expect(numberNth('21')).toBe('21st')
  })

  it('returns an empty string for falsy input', () => {
    expect(numberNth(null)).toBe('')
    expect(numberNth(undefined)).toBe('')
    expect(numberNth(0)).toBe('')
  })
})

describe('kFormatter', () => {
  it('returns 0 for falsy input', () => {
    expect(kFormatter(null)).toBe(0)
    expect(kFormatter(undefined)).toBe(0)
    expect(kFormatter(0)).toBe(0)
  })

  it('returns the signed value untouched below 1000', () => {
    expect(kFormatter(999)).toBe(999)
    expect(kFormatter(500)).toBe(500)
    expect(kFormatter(-500)).toBe(-500)
    expect(kFormatter(-999)).toBe(-999)
  })

  it('formats thousands with a K suffix', () => {
    expect(kFormatter(1000)).toBe('1K')
    expect(kFormatter(1500)).toBe('1.5K')
    expect(kFormatter(-1500)).toBe('-1.5K')
    expect(kFormatter(999999)).toBe('1000K')
  })

  it('formats millions with an M suffix', () => {
    expect(kFormatter(1000000)).toBe('1M')
    expect(kFormatter(1500000)).toBe('1.5M')
    expect(kFormatter(-2000000)).toBe('-2M')
  })
})

describe('formatPhoneNumber', () => {
  it('returns an empty string for falsy input', () => {
    expect(formatPhoneNumber(null)).toBe('')
    expect(formatPhoneNumber(undefined)).toBe('')
    expect(formatPhoneNumber('')).toBe('')
  })

  it('formats a full 10-digit number', () => {
    expect(formatPhoneNumber('2345678901')).toBe('(234) 567-8901')
    expect(formatPhoneNumber('(234) 567-8901')).toBe('(234) 567-8901')
  })

  it('strips a leading country-code 1', () => {
    expect(formatPhoneNumber('1234567890')).toBe('(234) 567-890')
  })

  it('formats partial input based on how many digits are present', () => {
    expect(formatPhoneNumber('234567')).toBe('(234) 567')
    expect(formatPhoneNumber('2345')).toBe('(234) 5')
    expect(formatPhoneNumber('234')).toBe('(234')
    expect(formatPhoneNumber('2')).toBe('(2')
  })
})

describe('formatDisplayPhoneNumber', () => {
  it('returns an empty string for falsy input', () => {
    expect(formatDisplayPhoneNumber(null)).toBe('')
    expect(formatDisplayPhoneNumber(undefined)).toBe('')
    expect(formatDisplayPhoneNumber('')).toBe('')
  })

  it('formats the last 10 digits of the input', () => {
    expect(formatDisplayPhoneNumber('2345678901')).toBe('(234) 567-8901')
    expect(formatDisplayPhoneNumber('12345678901')).toBe('(234) 567-8901')
    expect(formatDisplayPhoneNumber('+1 (234) 567-8901')).toBe('(234) 567-8901')
  })

  it('returns an empty string when there are not exactly 10 digits', () => {
    expect(formatDisplayPhoneNumber('12345')).toBe('')
    expect(formatDisplayPhoneNumber('abc')).toBe('')
  })
})
