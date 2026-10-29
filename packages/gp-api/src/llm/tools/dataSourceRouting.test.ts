import { describe, expect, it } from 'vitest'
import {
  DATA_SOURCE_ROUTING_RULES,
  dataSourceRoutingRules,
} from './dataSourceRouting'

describe('DATA_SOURCE_ROUTING_RULES', () => {
  // Win and Serve mandate opposite audience nouns for this data ("voters" vs
  // "constituents"); shared rule text has to use neither.
  it('uses neither product audience noun', () => {
    expect(DATA_SOURCE_ROUTING_RULES).not.toMatch(/\bconstituents\b/i)
    expect(DATA_SOURCE_ROUTING_RULES).not.toMatch(/\bvoters\b/i)
  })

  it('is the voters dataset text', () => {
    expect(DATA_SOURCE_ROUTING_RULES).toBe(
      dataSourceRoutingRules({ base: 'voters' }),
    )
    expect(DATA_SOURCE_ROUTING_RULES).not.toMatch(/not registered to vote/i)
  })
})

describe('dataSourceRoutingRules on the constituents dataset', () => {
  const rules = dataSourceRoutingRules({ base: 'constituents' })

  it('stops calling the mart a voter file', () => {
    expect(rules).not.toMatch(/voter-file/i)
    expect(rules).toMatch(/district constituent mart/i)
  })

  it('tells the model which base a total counts', () => {
    expect(rules).toMatch(/not registered to vote/i)
  })

  it('still uses neither product audience noun', () => {
    expect(rules).not.toMatch(/\bconstituents\b/i)
    expect(rules).not.toMatch(/\bvoters\b/i)
  })
})
