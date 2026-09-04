import { describe, expect, it } from 'vitest'
import {
  PhoneBankingScriptDraftRequestSchema,
  ServePhoneBankingScriptDraftRequestSchema,
} from './PhoneBankingScript.schema'
import { SERVE_PHONE_BANKING_PURPOSE_VALUES } from '../phoneBanking/PhoneBankingCreate.schema'

describe('PhoneBankingScriptDraftRequestSchema', () => {
  it('accepts a fresh generation with no currentDraft or previousDraft', () => {
    const request = { purpose: 'introduce_myself', tone: 'warm' }
    expect(() =>
      PhoneBankingScriptDraftRequestSchema.parse(request),
    ).not.toThrow()
  })

  it('accepts currentDraft alone (improve path)', () => {
    const request = {
      purpose: 'introduce_myself',
      tone: 'warm',
      currentDraft: 'My own words.',
    }
    expect(() =>
      PhoneBankingScriptDraftRequestSchema.parse(request),
    ).not.toThrow()
  })

  it('accepts previousDraft alone (regenerate-variation path)', () => {
    const request = {
      purpose: 'introduce_myself',
      tone: 'warm',
      previousDraft: 'A script the candidate rejected.',
    }
    expect(() =>
      PhoneBankingScriptDraftRequestSchema.parse(request),
    ).not.toThrow()
  })

  it('accepts instructions alongside either currentDraft or previousDraft', () => {
    const withCurrentDraft = {
      purpose: 'introduce_myself',
      tone: 'warm',
      currentDraft: 'My own words.',
      instructions: 'mention the school levy',
    }
    const withPreviousDraft = {
      purpose: 'introduce_myself',
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

  it('normalizes whitespace-only instructions to absent instead of rejecting', () => {
    const request = {
      purpose: 'introduce_myself',
      tone: 'warm',
      instructions: '   ',
    }
    const parsed = PhoneBankingScriptDraftRequestSchema.parse(request)
    expect(parsed.instructions).toBeUndefined()
  })

  it('rejects currentDraft and previousDraft together', () => {
    const request = {
      purpose: 'introduce_myself',
      tone: 'warm',
      currentDraft: 'My own words.',
      previousDraft: 'A script the candidate rejected.',
    }
    expect(() => PhoneBankingScriptDraftRequestSchema.parse(request)).toThrow(
      /currentDraft and previousDraft are mutually exclusive/,
    )
  })

  it('rejects a serve-only purpose slug', () => {
    const request = { purpose: 'explain_decision', tone: 'warm' }
    expect(() => PhoneBankingScriptDraftRequestSchema.parse(request)).toThrow()
  })
})

describe('ServePhoneBankingScriptDraftRequestSchema', () => {
  it.each(SERVE_PHONE_BANKING_PURPOSE_VALUES)(
    'accepts the serve purpose slug %s',
    (purpose) => {
      const request = { purpose, tone: 'warm' as const }
      expect(() =>
        ServePhoneBankingScriptDraftRequestSchema.parse(request),
      ).not.toThrow()
    },
  )

  it.each(['persuade_voters', 'early_voting', 'election_day_turnout'])(
    'rejects the Win-only purpose slug %s',
    (purpose) => {
      const request = { purpose, tone: 'warm' as const }
      expect(() =>
        ServePhoneBankingScriptDraftRequestSchema.parse(request),
      ).toThrow()
    },
  )

  it('rejects currentDraft and previousDraft together', () => {
    const request = {
      purpose: 'introduce_myself' as const,
      tone: 'warm' as const,
      currentDraft: 'My own words.',
      previousDraft: 'A script the candidate rejected.',
    }
    expect(() =>
      ServePhoneBankingScriptDraftRequestSchema.parse(request),
    ).toThrow(/currentDraft and previousDraft are mutually exclusive/)
  })
})
