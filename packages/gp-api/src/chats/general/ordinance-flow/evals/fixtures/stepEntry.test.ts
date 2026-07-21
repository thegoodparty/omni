import { describe, expect, it } from 'vitest'
import { deriveStepEntry, loadOrdinanceFixture } from './stepEntry'

describe('ordinance step-entry fixtures', () => {
  it('loads a captured record with its artifacts intact', () => {
    const rec = loadOrdinanceFixture('bike-parking')
    expect(rec.goalText).toContain('bike parking')
    expect(rec.clarifyAnswers?.length).toBe(5)
    expect(rec.authority?.status).toBeDefined()
    expect(rec.draftBody?.length).toBeGreaterThan(1000)
  })

  it('derives the clarify entry state: goal only, no artifacts', () => {
    const entry = deriveStepEntry(
      loadOrdinanceFixture('bike-parking'),
      'clarify',
    )
    expect(entry.goalText).toContain('bike parking')
    expect(entry.clarifyAnswers).toBeNull()
    expect(entry.authority).toBeNull()
    expect(entry.draftBody).toBeNull()
  })

  it('derives the authority entry state: clarify answers only', () => {
    const entry = deriveStepEntry(
      loadOrdinanceFixture('bike-parking'),
      'authority',
    )
    expect(entry.clarifyAnswers?.length).toBe(5)
    expect(entry.authority).toBeNull()
    expect(entry.existingLaw).toBeNull()
  })

  it('derives the draft entry state: all research, no draft', () => {
    const entry = deriveStepEntry(loadOrdinanceFixture('bike-parking'), 'draft')
    expect(entry.clarifyAnswers?.length).toBe(5)
    expect(entry.authority).not.toBeNull()
    expect(entry.comparables).not.toBeNull()
    expect(entry.draftTitle).toBeNull()
    expect(entry.draftBody).toBeNull()
    expect(entry.qualityReport).toBeNull()
  })

  it('keeps the full record for review entry', () => {
    const entry = deriveStepEntry(
      loadOrdinanceFixture('bike-parking-redraft'),
      'review',
    )
    expect(entry.draftBody).not.toBeNull()
    expect(entry.qualityReport).not.toBeNull()
  })

  it('every captured fixture parses', () => {
    for (const name of [
      'shade-trees',
      'bike-parking',
      'bike-parking-redraft',
      'oil-spill',
      'oil-spill-early',
    ] as const) {
      expect(loadOrdinanceFixture(name).name).toBe(name)
    }
  })
})
