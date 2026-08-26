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
})
