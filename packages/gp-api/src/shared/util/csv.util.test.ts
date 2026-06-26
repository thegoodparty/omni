import { describe, expect, it } from 'vitest'
import { neutralizeCsvFormula } from './csv.util'

describe('neutralizeCsvFormula', () => {
  it('prefixes a quote for cells starting with a formula character', () => {
    for (const char of ['=', '+', '-', '@']) {
      expect(neutralizeCsvFormula(`${char}HYPERLINK("http://evil")`)).toBe(
        `'${char}HYPERLINK("http://evil")`,
      )
    }
  })

  it('leaves ordinary values untouched', () => {
    expect(neutralizeCsvFormula('First Name')).toBe('First Name')
    expect(neutralizeCsvFormula('Age 30+')).toBe('Age 30+')
    expect(neutralizeCsvFormula('')).toBe('')
  })
})
