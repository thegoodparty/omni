import { describe, expect, it } from 'vitest'
import {
  PLAN_SECTION_ORDER,
  getNumberedPlanSections,
} from './planSectionManifest'

describe('plan section manifest', () => {
  it('lists the canonical 11 sections in ClickUp-template order', () => {
    expect(PLAN_SECTION_ORDER.map((s) => s.key)).toEqual([
      'executiveSummary',
      'strategicLandscape',
      'electoralGoals',
      'voterInsights',
      'resources',
      'timeline',
      'community',
      'voterContact',
      'measurement',
      'methodology',
      'glossary',
    ])
  })

  it('marks no section optional — Sizing Up Your Race is templated and always renders', () => {
    const optional = PLAN_SECTION_ORDER.filter((s) => s.optional).map(
      (s) => s.key,
    )
    expect(optional).toEqual([])
  })

  describe('getNumberedPlanSections', () => {
    it('numbers all 11 sections 1..11 regardless of the strategic-landscape flag', () => {
      const expected = [
        ['executiveSummary', 1],
        ['strategicLandscape', 2],
        ['electoralGoals', 3],
        ['voterInsights', 4],
        ['resources', 5],
        ['timeline', 6],
        ['community', 7],
        ['voterContact', 8],
        ['measurement', 9],
        ['methodology', 10],
        ['glossary', 11],
      ]
      expect(
        getNumberedPlanSections(true).map((s) => [s.key, s.number]),
      ).toEqual(expected)
      // With no optional sections the hide flag is a no-op.
      expect(
        getNumberedPlanSections(false).map((s) => [s.key, s.number]),
      ).toEqual(expected)
    })
  })
})
