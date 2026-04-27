import { describe, it, expect } from 'vitest'
import { electedOfficeSchema } from './schema'

describe('schema transforms', () => {
  describe('numberOrNull (via electedOfficeSchema)', () => {
    it('transforms null to null', () => {
      const result = electedOfficeSchema.parse({
        isActive: true,
        termLengthDays: null,
      })
      expect(result.termLengthDays).toBeNull()
    })

    it('transforms undefined to null', () => {
      const result = electedOfficeSchema.parse({ isActive: true })
      expect(result.termLengthDays).toBeNull()
    })

    it('transforms empty string to null', () => {
      const result = electedOfficeSchema.parse({
        isActive: true,
        termLengthDays: '',
      })
      expect(result.termLengthDays).toBeNull()
    })

    it('transforms valid number string to number', () => {
      const result = electedOfficeSchema.parse({
        isActive: true,
        termLengthDays: '365',
      })
      expect(result.termLengthDays).toBe(365)
    })

    it('transforms NaN-producing string to null', () => {
      const result = electedOfficeSchema.parse({
        isActive: true,
        termLengthDays: 'abc',
      })
      expect(result.termLengthDays).toBeNull()
    })
  })
})
