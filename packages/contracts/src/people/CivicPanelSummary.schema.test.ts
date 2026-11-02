import { describe, expect, it } from 'vitest'
import { civicPanelFreshnessText } from './CivicPanelSummary.schema'

describe('civicPanelFreshnessText', () => {
  it('counts the groups short of active members', () => {
    expect(civicPanelFreshnessText(1)).toBe('1 group needs fresh voices')
    expect(civicPanelFreshnessText(4)).toBe('4 groups need fresh voices')
    expect(civicPanelFreshnessText(0)).toBe('Every group has fresh voices')
  })
})
