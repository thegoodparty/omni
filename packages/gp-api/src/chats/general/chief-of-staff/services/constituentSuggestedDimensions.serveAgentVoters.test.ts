import { describe, expect, it } from 'vitest'
import { SERVE_AGENT_VOTER_DIMENSIONS } from './constituentDimensions.serveAgentVoters'
import { SERVE_AGENT_VOTER_SUGGESTED_DIMENSIONS } from './constituentSuggestedDimensions.serveAgentVoters'

// The catalog is the model's only meaning surface for these columns, and the
// file is regenerated (LLM-assisted curation, no script). These tests exist so
// a regeneration that reverts labels to Title-Case placeholders, drops the
// coverage / off-center marks, or advertises a column the validator would
// reject cannot land green.

const hsEntries = SERVE_AGENT_VOTER_SUGGESTED_DIMENSIONS.filter((d) =>
  d.name.startsWith('hs_'),
)

const titleCaseOf = (name: string): string =>
  name
    .replace(/^hs_/, '')
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')

describe('serve suggested dimensions — catalog integrity', () => {
  it('advertises only dimensions present in the mart allowlist', () => {
    const allowed = new Set(SERVE_AGENT_VOTER_DIMENSIONS)
    for (const dim of SERVE_AGENT_VOTER_SUGGESTED_DIMENSIONS) {
      expect(allowed.has(dim.name), `missing from mart: ${dim.name}`).toBe(true)
    }
  })

  it('advertises each dimension exactly once', () => {
    const names = SERVE_AGENT_VOTER_SUGGESTED_DIMENSIONS.map((d) => d.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('gives every hs_ dimension a meaning label, not a Title-Case placeholder', () => {
    for (const dim of hsEntries) {
      expect(dim.label.trim().length, dim.name).toBeGreaterThan(0)
      expect(dim.label, `placeholder label: ${dim.name}`).not.toBe(
        titleCaseOf(dim.name),
      )
    }
  })

  it('states value tokens on the categorical demographic dimensions', () => {
    // These are STRING categoricals whose tokens are vendor-inconsistent and
    // unguessable; the label is where the model learns the exact values.
    const mustCarryValues = [
      'Voters_Gender',
      'ConsumerData_RUS_Code',
      'ConsumerData_Education_of_Person',
      'ConsumerData_Marital_Status',
    ]
    for (const name of mustCarryValues) {
      const dim = SERVE_AGENT_VOTER_SUGGESTED_DIMENSIONS.find(
        (d) => d.name === name,
      )
      expect(dim, `expected advertised entry: ${name}`).toBeDefined()
      expect(dim!.label, `no value tokens stated: ${name}`).toMatch(/values? '/)
    }
  })
})

describe('serve suggested dimensions — mark coupling with HS_SCORE_SEMANTICS', () => {
  // HS_SCORE_SEMANTICS tells the model exceptions "are marked on catalog
  // entries". These counts pin the marks to the verified warehouse story
  // (2026-08-04): re-verify against the mart before changing them.

  it('marks exactly the two off-center columns', () => {
    const offCenter = SERVE_AGENT_VOTER_SUGGESTED_DIMENSIONS.filter((d) =>
      d.label.includes('not centered at 50'),
    ).map((d) => d.name)
    expect(offCenter.sort()).toEqual(['hs_any_home_buyer', 'hs_new_home_buyer'])
  })

  it('marks the 106 vintage-limited columns, split by vintage direction', () => {
    const twelveStateOnly = hsEntries.filter((d) =>
      d.label.includes('limited coverage: data exists in only 12 states'),
    )
    const thirtyNineStateOnly = hsEntries.filter((d) =>
      d.label.includes('limited coverage: no data in 12 states'),
    )
    expect(twelveStateOnly.length).toBe(51)
    expect(thirtyNineStateOnly.length).toBe(55)
    // Spot anchors, one per vintage (per hs_coverage_report.json).
    expect(twelveStateOnly.map((d) => d.name)).toContain(
      'hs_conspiracy_believer',
    )
    expect(thirtyNineStateOnly.map((d) => d.name)).toContain(
      'hs_voting_fraud_concern_barriers',
    )
    // Full-coverage columns must stay unmarked. hs_doge_support is the trap:
    // it is schema-absent from the 12-state staging set but has real data in
    // all 51 states, so coverage (not schema presence) decides the mark.
    for (const name of ['hs_gun_control_support', 'hs_doge_support']) {
      const dim = hsEntries.find((d) => d.name === name)
      expect(dim?.label, name).not.toContain('limited coverage')
    }
  })
})
