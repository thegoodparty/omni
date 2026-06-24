import { PeopleListResponseSchema } from '@goodparty_org/contracts'
import { describe, expect, it } from 'vitest'
import { buildPreviewContacts } from './previewContacts.utils'

describe('buildPreviewContacts', () => {
  it('produces a page of rows that satisfy the people contract', () => {
    const result = buildPreviewContacts({
      resultsPerPage: 10,
      page: 1,
      totalResults: 1234,
    })

    expect(result.people).toHaveLength(10)
    // The preview is forwarded as a real /v1/contacts response, so it must
    // parse against the shared contract or the webapp would reject it.
    expect(() => PeopleListResponseSchema.parse(result)).not.toThrow()
  })

  it('reports the real aggregate total so the unblurred stat card does not regress', () => {
    const { pagination } = buildPreviewContacts({
      resultsPerPage: 50,
      page: 1,
      totalResults: 12431,
    })

    expect(pagination.totalResults).toBe(12431)
    expect(pagination.totalPages).toBe(Math.ceil(12431 / 50))
    expect(pagination.hasNextPage).toBe(true)
    expect(pagination.hasPreviousPage).toBe(false)
  })

  it('only emits fabricated phone numbers in the fiction-reserved 555-01xx range', () => {
    const { people } = buildPreviewContacts({
      resultsPerPage: 50,
      page: 1,
      totalResults: 500,
    })

    for (const person of people) {
      expect(person.cellPhone).toMatch(/555-01\d\d$/)
      expect(person.landline).toMatch(/555-01\d\d$/)
    }
  })

  it('gives rows distinct synthetic ids across pages', () => {
    const page1 = buildPreviewContacts({
      resultsPerPage: 10,
      page: 1,
      totalResults: 100,
    })
    const page2 = buildPreviewContacts({
      resultsPerPage: 10,
      page: 2,
      totalResults: 100,
    })

    const ids = new Set(
      [...page1.people, ...page2.people].map((person) => person.id),
    )
    expect(ids.size).toBe(20)
    expect(page2.pagination.hasPreviousPage).toBe(true)
  })

  it('clamps the final page to the real total instead of overfilling', () => {
    const result = buildPreviewContacts({
      resultsPerPage: 10,
      page: 3,
      totalResults: 25,
    })

    // 25 total, 10/page => page 3 holds the trailing 5 rows, and is the last.
    expect(result.people).toHaveLength(5)
    expect(result.pagination.hasNextPage).toBe(false)
  })

  it('returns an empty page when the district has no voters', () => {
    const result = buildPreviewContacts({
      resultsPerPage: 50,
      page: 1,
      totalResults: 0,
    })

    expect(result.people).toHaveLength(0)
    expect(result.pagination.totalResults).toBe(0)
    expect(result.pagination.totalPages).toBe(0)
  })
})
