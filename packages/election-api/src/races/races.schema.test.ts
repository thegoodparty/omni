import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RACE_PAGE_SIZE,
  MAX_RACE_PAGE_SIZE,
  raceFilterSchema,
} from './races.schema'

describe('raceFilterSchema pagination', () => {
  it('applies the default page and pageSize when none are provided', () => {
    const result = raceFilterSchema.parse({})
    expect(result.page).toBe(1)
    expect(result.pageSize).toBe(DEFAULT_RACE_PAGE_SIZE)
  })

  it('coerces string query params into numbers', () => {
    // Query params arrive as strings; the schema must coerce them so the
    // service can compute a numeric skip/take.
    const result = raceFilterSchema.parse({ page: '3', pageSize: '50' })
    expect(result.page).toBe(3)
    expect(result.pageSize).toBe(50)
  })

  it('rejects a pageSize above the hard maximum', () => {
    const result = raceFilterSchema.safeParse({
      pageSize: MAX_RACE_PAGE_SIZE + 1,
    })
    expect(result.success).toBe(false)
  })

  it('accepts a pageSize at the hard maximum', () => {
    const result = raceFilterSchema.safeParse({ pageSize: MAX_RACE_PAGE_SIZE })
    expect(result.success).toBe(true)
  })

  it('rejects a non-positive page', () => {
    expect(raceFilterSchema.safeParse({ page: 0 }).success).toBe(false)
    expect(raceFilterSchema.safeParse({ page: -1 }).success).toBe(false)
  })
})

describe('raceFilterSchema candidacyColumns validation', () => {
  it('rejects the email PII column', () => {
    const result = raceFilterSchema.safeParse({ candidacyColumns: 'id,email' })
    expect(result.success).toBe(false)
  })

  it('accepts valid candidacy columns', () => {
    // firstName/lastName exist on Candidacy but NOT on Place — under the old
    // (buggy) placeColumns check these were wrongly rejected. This asserts the
    // validator now uses the candidacy allowlist.
    const result = raceFilterSchema.safeParse({
      candidacyColumns: 'id,firstName,lastName',
    })
    expect(result.success).toBe(true)
  })
})
