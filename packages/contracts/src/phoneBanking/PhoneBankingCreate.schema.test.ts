import { describe, expect, it } from 'vitest'
import {
  PhoneBankingCreateSchema,
  ServePhoneBankingCreateSchema,
  SERVE_PHONE_BANKING_PURPOSE_VALUES,
} from './PhoneBankingCreate.schema'

const base = {
  name: 'GOTV week 1',
  script: 'Hi, this is a volunteer calling on behalf of...',
  sheetCount: 1,
  voterFileFilterId: 42,
  purpose: 'introduce_myself' as const,
}

describe('PhoneBankingCreateSchema', () => {
  it('accepts a saved-filter create request', () => {
    expect(() => PhoneBankingCreateSchema.parse(base)).not.toThrow()
  })

  it('rejects sheetCount of 0', () => {
    expect(() =>
      PhoneBankingCreateSchema.parse({ ...base, sheetCount: 0 }),
    ).toThrow()
  })

  it('rejects sheetCount of 21', () => {
    expect(() =>
      PhoneBankingCreateSchema.parse({ ...base, sheetCount: 21 }),
    ).toThrow()
  })

  it('rejects a missing voterFileFilterId', () => {
    const request = { ...base, voterFileFilterId: undefined }
    expect(() => PhoneBankingCreateSchema.parse(request)).toThrow()
  })

  it('rejects inline filters — the audience is always a saved filter', () => {
    const request = {
      ...base,
      filters: { hasCellPhone: true },
      filterName: 'GOTV audience',
    }
    expect(() => PhoneBankingCreateSchema.parse(request)).toThrow()
  })

  it('rejects a script over 5000 characters', () => {
    const request = { ...base, script: 'x'.repeat(5_001) }
    expect(() => PhoneBankingCreateSchema.parse(request)).toThrow()
  })

  it('rejects a serve-only purpose slug', () => {
    const request = { ...base, purpose: 'explain_decision' }
    expect(() => PhoneBankingCreateSchema.parse(request)).toThrow()
  })
})

describe('ServePhoneBankingCreateSchema', () => {
  const serveBase = { ...base, purpose: 'introduce_myself' as const }

  it('accepts a saved-filter create request', () => {
    expect(() => ServePhoneBankingCreateSchema.parse(serveBase)).not.toThrow()
  })

  it.each(SERVE_PHONE_BANKING_PURPOSE_VALUES)(
    'accepts the serve purpose slug %s',
    (purpose) => {
      // community_input is the one purpose that asks a question rather than
      // delivering a message, so it is the one that has to carry what the
      // question is.
      const request =
        purpose === 'community_input'
          ? {
              ...serveBase,
              purpose,
              communityInputQuestion: 'Would you take part in a compost pilot?',
            }
          : { ...serveBase, purpose }
      expect(() => ServePhoneBankingCreateSchema.parse(request)).not.toThrow()
    },
  )

  it('refuses community_input with no question to ask', () => {
    expect(() =>
      ServePhoneBankingCreateSchema.parse({
        ...serveBase,
        purpose: 'community_input',
      }),
    ).toThrow()
  })

  // A question recorded against a purpose that never asks one would still be
  // handed to the extraction running at every call.
  it('refuses a question on a purpose that does not ask one', () => {
    expect(() =>
      ServePhoneBankingCreateSchema.parse({
        ...serveBase,
        purpose: 'introduce_myself',
        communityInputQuestion: 'Would you take part in a compost pilot?',
      }),
    ).toThrow()
  })

  it.each(['persuade_voters', 'early_voting', 'election_day_turnout'])(
    'rejects the Win-only purpose slug %s',
    (purpose) => {
      expect(() =>
        ServePhoneBankingCreateSchema.parse({ ...serveBase, purpose }),
      ).toThrow()
    },
  )
})
