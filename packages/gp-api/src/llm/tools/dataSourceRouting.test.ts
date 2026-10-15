import { describe, expect, it } from 'vitest'
import {
  DATA_SOURCE_ROUTING_RULES,
  dataSourceRoutingRules,
} from './dataSourceRouting'

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

  it('is the voters dataset text', () => {
    expect(DATA_SOURCE_ROUTING_RULES).toBe(dataSourceRoutingRules('voters'))
    expect(DATA_SOURCE_ROUTING_RULES).not.toMatch(/not registered to vote/i)
  })
})

describe('dataSourceRoutingRules on the constituents dataset', () => {
  const rules = dataSourceRoutingRules('constituents')

  it('stops calling the mart a voter file', () => {
    expect(rules).not.toMatch(/voter-file/i)
    expect(rules).toMatch(/district constituent mart/i)
  })

  it('tells the model which base a total counts', () => {
    expect(rules).toContain(
      'Totals include adult residents whether or not they are registered to vote',
    )
    expect(rules).toMatch(/cover only residents registered to vote/i)
    expect(rules).toMatch(/say which of the two it counts/i)
  })

  it('still uses neither product audience noun', () => {
    expect(rules).not.toMatch(/\bconstituents\b/i)
    expect(rules).not.toMatch(/\bvoters\b/i)
  })
})
