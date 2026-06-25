import { describe, expect, it } from 'vitest'
import { listContactsSchema } from './listContacts.schema'

describe('listContactsSchema', () => {
  it('defaults resultsPerPage and page when omitted', () => {
    const parsed = listContactsSchema.parse({})

    expect(parsed.resultsPerPage).toBe(50)
    expect(parsed.page).toBe(1)
  })

  it('rejects an unbounded resultsPerPage (full voter-set extraction / OOM)', () => {
    expect(
      listContactsSchema.safeParse({ resultsPerPage: 100000000 }).success,
    ).toBe(false)
  })

  it('rejects a non-positive page', () => {
    expect(listContactsSchema.safeParse({ page: 0 }).success).toBe(false)
  })

  it('rejects an excessively deep page (huge SQL OFFSET / full scan)', () => {
    expect(listContactsSchema.safeParse({ page: 2147483647 }).success).toBe(
      false,
    )
  })

  it('accepts resultsPerPage at the max bound', () => {
    const parsed = listContactsSchema.parse({ resultsPerPage: 10000 })

    expect(parsed.resultsPerPage).toBe(10000)
  })

  it('rejects a page × resultsPerPage offset beyond the cap', () => {
    // Per-field caps alone still permit a ~1e9 OFFSET; the combined cap blocks
    // it (201-1) * 10000 = 2,000,000 > 1,000,000.
    expect(
      listContactsSchema.safeParse({ page: 201, resultsPerPage: 10000 })
        .success,
    ).toBe(false)
  })

  it('accepts a deep page whose offset is within the cap', () => {
    // (20000 - 1) * 50 = 999,950 <= 1,000,000.
    expect(
      listContactsSchema.safeParse({ page: 20000, resultsPerPage: 50 }).success,
    ).toBe(true)
  })
})
