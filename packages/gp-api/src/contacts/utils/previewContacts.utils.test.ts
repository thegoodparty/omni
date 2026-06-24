import { PeopleListResponseSchema } from '@goodparty_org/contracts'
import { describe, expect, it } from 'vitest'
import { buildPreviewContacts } from './previewContacts.utils'

describe('buildPreviewContacts', () => {
  it('produces the requested number of rows that satisfy the people contract', () => {
    const result = buildPreviewContacts(10)

    expect(result.people).toHaveLength(10)
    // The preview is forwarded as a real /v1/contacts response, so it must
    // parse against the shared contract or the webapp would reject it.
    expect(() => PeopleListResponseSchema.parse(result)).not.toThrow()
  })

  it('only emits fabricated phone numbers in the fiction-reserved 555-01xx range', () => {
    const { people } = buildPreviewContacts(50)

    for (const person of people) {
      expect(person.cellPhone).toMatch(/555-01\d\d$/)
      expect(person.landline).toMatch(/555-01\d\d$/)
    }
  })

  it('gives each row a distinct synthetic id', () => {
    const { people } = buildPreviewContacts(25)

    const ids = new Set(people.map((person) => person.id))
    expect(ids.size).toBe(25)
  })

  it('is a single non-paginated page so the upsell can not be paged through', () => {
    const { pagination } = buildPreviewContacts(50)

    expect(pagination.totalPages).toBe(1)
    expect(pagination.hasNextPage).toBe(false)
    expect(pagination.hasPreviousPage).toBe(false)
    expect(pagination.totalResults).toBe(50)
  })

  it('returns an empty page for a zero or negative count', () => {
    expect(buildPreviewContacts(0).people).toHaveLength(0)
    expect(buildPreviewContacts(-5).people).toHaveLength(0)
  })
})
