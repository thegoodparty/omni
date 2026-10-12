import { describe, expect, it } from 'vitest'
import { DATA_SOURCE_ROUTING_RULES } from './dataSourceRouting'

describe('DATA_SOURCE_ROUTING_RULES', () => {
  it('names the dimensions that live in only one catalog', () => {
    expect(DATA_SOURCE_ROUTING_RULES).toMatch(/registration status/i)
    expect(DATA_SOURCE_ROUTING_RULES).toMatch(/voter-file mart/i)
    expect(DATA_SOURCE_ROUTING_RULES).toContain('hs_*')
  })

  it('tells the model to check the other catalog before declaring absence', () => {
    expect(DATA_SOURCE_ROUTING_RULES).toMatch(/check the other catalog/i)
    expect(DATA_SOURCE_ROUTING_RULES).toMatch(/do not conclude absence/i)
  })

  it('names the confused pair so the substitution ban is concrete', () => {
    expect(DATA_SOURCE_ROUTING_RULES).toContain('Voter Likelihood')
    expect(DATA_SOURCE_ROUTING_RULES).toMatch(/is not registration status/i)
  })

  // Win and Serve mandate opposite audience nouns for this data ("voters" vs
  // "constituents"); shared rule text has to use neither.
  it('uses neither product audience noun', () => {
    expect(DATA_SOURCE_ROUTING_RULES).not.toMatch(/\bconstituents\b/i)
    expect(DATA_SOURCE_ROUTING_RULES).not.toMatch(/\bvoters\b/i)
  })
})
