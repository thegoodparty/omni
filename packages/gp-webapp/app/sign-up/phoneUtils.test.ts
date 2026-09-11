import { describe, it, expect } from 'vitest'
import { nextPhoneDigits } from './phoneUtils'

describe('nextPhoneDigits', () => {
  it('keeps only digits from the formatted input', () => {
    expect(nextPhoneDigits('555', '(555) 1')).toBe('5551')
  })

  it('drops a digit when a keystroke removed only punctuation', () => {
    // Backspacing '(555)' deletes the ')', leaving the same three digits.
    expect(nextPhoneDigits('555', '(555')).toBe('55')
  })

  it('accepts a normal digit deletion as-is', () => {
    expect(nextPhoneDigits('5551', '(555) ')).toBe('555')
  })

  it('ignores a digit past the cap rather than eating the last one', () => {
    expect(nextPhoneDigits('15551234567', '1 (555) 123-45678')).toBe(
      '15551234567',
    )
  })

  it('truncates a pasted over-long number to the cap', () => {
    expect(nextPhoneDigits('', '+1 555 123 4567 890')).toBe('15551234567')
  })

  it('clears to empty when the field is emptied', () => {
    expect(nextPhoneDigits('5551234567', '')).toBe('')
  })
})
