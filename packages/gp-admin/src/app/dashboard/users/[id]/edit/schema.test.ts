import { describe, it, expect } from 'vitest'
import { pathToVictorySchema, electedOfficeSchema } from './schema'

describe('schema transforms', () => {
  describe('numberOrUndefined (via pathToVictorySchema)', () => {
    it('transforms undefined to undefined', () => {
      const result = pathToVictorySchema.parse({})
      expect(result.winNumber).toBeUndefined()
    })

    it('transforms null to undefined', () => {
      const result = pathToVictorySchema.parse({ winNumber: null })
      expect(result.winNumber).toBeUndefined()
    })

    it('transforms empty string to undefined', () => {
      const result = pathToVictorySchema.parse({ winNumber: '' })
      expect(result.winNumber).toBeUndefined()
    })

    it('transforms valid number string to number', () => {
      const result = pathToVictorySchema.parse({ winNumber: '42' })
      expect(result.winNumber).toBe(42)
    })

    it('transforms NaN-producing string to undefined', () => {
      const result = pathToVictorySchema.parse({ winNumber: 'not-a-number' })
      expect(result.winNumber).toBeUndefined()
    })

    it('passes through numeric values', () => {
      const result = pathToVictorySchema.parse({ winNumber: 100 })
      expect(result.winNumber).toBe(100)
    })
  })

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
