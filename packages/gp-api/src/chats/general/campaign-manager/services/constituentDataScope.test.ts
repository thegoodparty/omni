import { describe, expect, it } from 'vitest'
import { WIN_AGENT_VOTER_DIMENSIONS } from './constituentDimensions.winAgentVoters'
import { WIN_AGENT_VOTER_SUGGESTED_DIMENSIONS } from './constituentSuggestedDimensions.winAgentVoters'
import {
  buildWinConstituentDataScope,
  WIN_CONSTITUENT_TABLES,
} from './constituentDataScope'

const FILTERS = [
  { column: 'state_postal_code', value: 'IL' },
  { column: 'City_Council_Commissioner_District', value: 'WARD 3' },
]

describe('win constituent scope', () => {
  it('advertises only dimensions present in the mart allowlist', () => {
    const allowed = new Set(WIN_AGENT_VOTER_DIMENSIONS)
    for (const dim of WIN_AGENT_VOTER_SUGGESTED_DIMENSIONS) {
      expect(allowed.has(dim.name), `missing from mart: ${dim.name}`).toBe(true)
    }
  })

  it('advertises the partisan block (Win-specific decision)', () => {
    const names = WIN_AGENT_VOTER_SUGGESTED_DIMENSIONS.map((d) => d.name)
    expect(names).toContain('Parties_Description')
    expect(names).toContain('hs_ideology_overall_party_dem')
  })

  it('does not forbid partisan columns, only identity backstops', () => {
    const scope = buildWinConstituentDataScope(FILTERS, WIN_CONSTITUENT_TABLES)
    expect(scope.forbiddenColumns.has('Parties_Description')).toBe(false)
    expect(scope.forbiddenColumns.has('party')).toBe(false)
    expect(scope.forbiddenColumns.has('email')).toBe(true)
    expect(scope.forbiddenColumns.has('voter_id')).toBe(true)
  })

  it('locks table, cell floor, and server-bound district filters', () => {
    const scope = buildWinConstituentDataScope(FILTERS, WIN_CONSTITUENT_TABLES)
    expect([...scope.allowedTables]).toEqual(['win_agent_voters'])
    expect(scope.minCellSize).toBe(100)
    expect(scope.mandatoryFilters).toEqual(FILTERS)
  })

  it('excludes voter_key from the dimension allowlist', () => {
    expect(WIN_AGENT_VOTER_DIMENSIONS).not.toContain('voter_key')
    const scope = buildWinConstituentDataScope(FILTERS, WIN_CONSTITUENT_TABLES)
    expect(scope.allowedDimensions.has('voter_key')).toBe(false)
  })
})
