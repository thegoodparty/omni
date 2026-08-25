import { describe, expect, it } from 'vitest'
import { PhoneBankingScriptDraftRequestSchema } from './PhoneBankingScript.schema'

describe('PhoneBankingScriptDraftRequestSchema', () => {
  it('accepts a fresh generation with no currentDraft or previousDraft', () => {
    const request = { purpose: 'introduce', tone: 'warm' }
    expect(() =>
      PhoneBankingScriptDraftRequestSchema.parse(request),
    ).not.toThrow()
  })

  it('accepts currentDraft alone (improve path)', () => {
    const request = {
      purpose: 'introduce',
      tone: 'warm',
      currentDraft: 'My own words.',
    }
    expect(() =>
      PhoneBankingScriptDraftRequestSchema.parse(request),
    ).not.toThrow()
  })

  it('accepts previousDraft alone (regenerate-variation path)', () => {
    const request = {
      purpose: 'introduce',
      tone: 'warm',
      previousDraft: 'A script the candidate rejected.',
    }
    expect(() =>
      PhoneBankingScriptDraftRequestSchema.parse(request),
    ).not.toThrow()
  })

  it('accepts instructions alongside either currentDraft or previousDraft', () => {
    const withCurrentDraft = {
      purpose: 'introduce',
      tone: 'warm',
      currentDraft: 'My own words.',
      instructions: 'mention the school levy',
    }
    const withPreviousDraft = {
      purpose: 'introduce',
      tone: 'warm',
      previousDraft: 'A script the candidate rejected.',
      instructions: 'mention the school levy',
    }
    expect(() =>
      PhoneBankingScriptDraftRequestSchema.parse(withCurrentDraft),
    ).not.toThrow()
    expect(() =>
      PhoneBankingScriptDraftRequestSchema.parse(withPreviousDraft),
    ).not.toThrow()
  })

  it('rejects currentDraft and previousDraft together', () => {
    const request = {
      purpose: 'introduce',
      tone: 'warm',
      currentDraft: 'My own words.',
      previousDraft: 'A script the candidate rejected.',
    }
    expect(() => PhoneBankingScriptDraftRequestSchema.parse(request)).toThrow(
      /currentDraft and previousDraft are mutually exclusive/,
    )
  })
})
