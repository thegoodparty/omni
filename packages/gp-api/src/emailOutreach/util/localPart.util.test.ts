import { describe, expect, it } from 'vitest'
import { buildLocalPartBase, withSuffix } from './localPart.util'

describe('buildLocalPartBase', () => {
  it('builds first.last from a full name', () => {
    expect(buildLocalPartBase('Renee Wells')).toBe('renee.wells')
  })

  it('uses the first and last words of a longer name', () => {
    expect(buildLocalPartBase('Renee Ann Wells')).toBe('renee.wells')
  })

  it('transliterates non-ASCII characters', () => {
    expect(buildLocalPartBase('José Muñoz')).toBe('jose.munoz')
  })

  it('falls through a name that transliterates to nothing', () => {
    expect(buildLocalPartBase('李雷', 'Office Of Wells')).toBe('office.wells')
  })

  it('handles a single word and a missing name', () => {
    expect(buildLocalPartBase('Renee')).toBe('renee')
    expect(buildLocalPartBase('', '  ')).toBeNull()
  })
})

describe('withSuffix', () => {
  it('numbers clashes from 2', () => {
    expect(withSuffix('renee.wells', 1)).toBe('renee.wells')
    expect(withSuffix('renee.wells', 2)).toBe('renee.wells2')
  })
})
