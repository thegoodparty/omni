import { describe, expect, it } from 'vitest'
import { PhoneBankingCreateSchema } from './PhoneBankingCreate.schema'

const base = {
  name: 'GOTV week 1',
  script: 'Hi, this is a volunteer calling on behalf of...',
  sheetCount: 1,
  voterFileFilterId: 42,
  purpose: 'introduce' as const,
}

describe('PhoneBankingCreateSchema', () => {
  it('accepts a saved-filter create request', () => {
    expect(() => PhoneBankingCreateSchema.parse(base)).not.toThrow()
  })

  it('accepts an inline-filters create request with a filterName', () => {
    const request = {
      ...base,
      voterFileFilterId: undefined,
      filters: { hasCellPhone: true },
      filterName: 'GOTV audience',
    }
    expect(() => PhoneBankingCreateSchema.parse(request)).not.toThrow()
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

  it('rejects both voterFileFilterId and filters supplied', () => {
    const request = {
      ...base,
      filters: { hasCellPhone: true },
      filterName: 'GOTV audience',
    }
    expect(() => PhoneBankingCreateSchema.parse(request)).toThrow(
      /exactly one of voterFileFilterId or filters/,
    )
  })

  it('rejects filters without a filterName', () => {
    const request = {
      ...base,
      voterFileFilterId: undefined,
      filters: { hasCellPhone: true },
    }
    expect(() => PhoneBankingCreateSchema.parse(request)).toThrow(
      /filterName is required/,
    )
  })

  it('rejects a script over 5000 characters', () => {
    const request = { ...base, script: 'x'.repeat(5_001) }
    expect(() => PhoneBankingCreateSchema.parse(request)).toThrow()
  })

  it('rejects neither voterFileFilterId nor filters supplied', () => {
    const request = { ...base, voterFileFilterId: undefined }
    expect(() => PhoneBankingCreateSchema.parse(request)).toThrow(
      /exactly one of voterFileFilterId or filters/,
    )
  })
})
