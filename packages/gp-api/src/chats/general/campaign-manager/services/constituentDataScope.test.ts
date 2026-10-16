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

  it('advertises each dimension exactly once', () => {
    const names = WIN_AGENT_VOTER_SUGGESTED_DIMENSIONS.map((d) => d.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('advertises the partisan block (Win-specific decision)', () => {
    const names = WIN_AGENT_VOTER_SUGGESTED_DIMENSIONS.map((d) => d.name)
    expect(names).toContain('Parties_Description')
    expect(names).toContain(
      'hs_ideology_partisanship_partisanship_overall_party_dem',
    )
  })

  // Mirrors the Serve pin at constituentSuggestedDimensions.serveAgentVoters
  // .test.ts. Without it, stripping the caveat here passes CI silently and
  // the agent recommends these columns in the 38+ states where they are null.
  it('marks the 2 mass-deportations columns with the 12-state coverage caveat', () => {
    const twelveStateOnly = WIN_AGENT_VOTER_SUGGESTED_DIMENSIONS.filter((d) =>
      d.label.includes('limited coverage: data exists in only 12 states'),
    )
    expect(twelveStateOnly.map((d) => d.name).sort()).toEqual([
      'hs_mass_deportations_oppose',
      'hs_mass_deportations_support',
    ])
  })

  // The label is the model's only cue for which way a score points, and a
  // noun phrase ("Mass Deportations Oppose") does not say whether a high
  // score is the voter opposing or being opposed.
  it('states the stance direction in the mass-deportations labels', () => {
    const labelFor = (name: string) =>
      WIN_AGENT_VOTER_SUGGESTED_DIMENSIONS.find((d) => d.name === name)?.label
    expect(labelFor('hs_mass_deportations_oppose')).toMatch(/^Opposes /)
    expect(labelFor('hs_mass_deportations_support')).toMatch(/^Supports /)
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

// Parties_Description is a registration only where the state reports one
// (peopleDb/partySource.ts). The labels are the model's only meaning surface,
// so they say how L2 assigned the value everywhere else.
describe('win constituent scope: party by state', () => {
  const labelFor = (state: string | null | undefined, name: string) =>
    buildWinConstituentDataScope(
      FILTERS,
      WIN_CONSTITUENT_TABLES,
      state,
    ).advertisedDimensions.find((d) => d.name === name)?.label

  it('keeps the registration wording where the state registers by party', () => {
    const scope = buildWinConstituentDataScope(
      FILTERS,
      WIN_CONSTITUENT_TABLES,
      'CA',
    )
    expect(scope.advertisedDimensions).toBe(
      WIN_AGENT_VOTER_SUGGESTED_DIMENSIONS,
    )
    expect(labelFor('CA', 'Parties_Description')).toBe('Party registration')
    expect(scope.partyNote).toBeNull()
  })

  it('keeps the registration wording when the state is unknown', () => {
    expect(labelFor(null, 'Parties_Description')).toBe('Party registration')
    expect(labelFor(undefined, 'Parties_Description')).toBe(
      'Party registration',
    )
    expect(
      buildWinConstituentDataScope(FILTERS, WIN_CONSTITUENT_TABLES).partyNote,
    ).toBeNull()
  })

  it('says the vendor assigned the value where party is modeled', () => {
    const scope = buildWinConstituentDataScope(
      FILTERS,
      WIN_CONSTITUENT_TABLES,
      'MN',
    )
    expect(labelFor('MN', 'Parties_Description')).toBe(
      'Party as the vendor assigns it, not a registration',
    )
    expect(labelFor('MN', 'Residence_HHParties_Description')).toBe(
      'Household party mix, built from the same assigned party values, ' +
        'not registrations',
    )
    expect(scope.partyNote).toBe(
      'Minnesota provides no party information in its voter file. The ' +
        "voter file vendor models every voter's party from commercial " +
        'data, with a limited amount of partisan-contribution and ' +
        'office-holding records.',
    )
  })

  it('says the same where the vendor assigns party from primary ballots', () => {
    expect(labelFor('GA', 'Parties_Description')).toBe(
      'Party as the vendor assigns it, not a registration',
    )
    expect(
      buildWinConstituentDataScope(FILTERS, WIN_CONSTITUENT_TABLES, 'ga')
        .partyNote,
    ).toMatch(/^Georgia voters do not register by party\./)
  })

  // The column seed says L2 leaves the flag empty where party is modeled, so
  // offering it there would send the model to a column of nulls. Where L2
  // assigns party from primary ballots the flag stays, worded as assigned.
  it('advertises the party-change flag only where the vendor could fill it', () => {
    expect(labelFor('MN', 'VoterParties_Change_Changed_Party')).toBe(undefined)
    expect(labelFor('GA', 'VoterParties_Change_Changed_Party')).toBe(
      'Has changed party, as the vendor assigns it',
    )
    expect(labelFor('CA', 'VoterParties_Change_Changed_Party')).toBe(
      'Has changed party registration',
    )
  })

  it('leaves every other dimension and the rest of the scope as it was', () => {
    const plain = buildWinConstituentDataScope(FILTERS, WIN_CONSTITUENT_TABLES)
    const modeled = buildWinConstituentDataScope(
      FILTERS,
      WIN_CONSTITUENT_TABLES,
      'MN',
    )
    const others = (scope: typeof plain) =>
      scope.advertisedDimensions.filter(
        (d) =>
          ![
            'Parties_Description',
            'Residence_HHParties_Description',
            'VoterParties_Change_Changed_Party',
          ].includes(d.name),
      )
    expect(others(modeled)).toEqual(others(plain))
    expect(modeled.allowedDimensions).toEqual(plain.allowedDimensions)
    expect(modeled.partisanQueriesAllowed).toBe(true)
  })
})
