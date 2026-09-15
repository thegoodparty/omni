import { describe, expect, it } from 'vitest'
import { personMergeFilterSchema } from './person-merges.schema'

const UUID = '11111111-1111-1111-1111-111111111111'

describe('personMergeFilterSchema', () => {
  it('defaults to a bounded page with no cursor', () => {
    const parsed = personMergeFilterSchema.parse({})
    expect(parsed).toEqual({ limit: 500 })
  })

  it('coerces limit from the query string and caps it', () => {
    expect(personMergeFilterSchema.parse({ limit: '25' }).limit).toBe(25)
    expect(personMergeFilterSchema.safeParse({ limit: '5000' }).success).toBe(
      false,
    )
  })

  it('accepts a since/sinceId keyset cursor', () => {
    const parsed = personMergeFilterSchema.parse({
      since: '2026-09-10T00:00:00.000Z',
      sinceId: UUID,
    })
    expect(parsed).toMatchObject({
      since: '2026-09-10T00:00:00.000Z',
      sinceId: UUID,
    })
  })

  it('rejects sinceId without since', () => {
    // It is only a tiebreak within a timestamp. Accepting it alone would
    // silently ignore it and hand back rows the consumer already processed.
    const result = personMergeFilterSchema.safeParse({ sinceId: UUID })
    expect(result.success).toBe(false)
  })

  it('rejects a non-ISO since', () => {
    expect(
      personMergeFilterSchema.safeParse({ since: 'yesterday' }).success,
    ).toBe(false)
  })

  it('rejects unknown query params', () => {
    expect(personMergeFilterSchema.safeParse({ cursor: UUID }).success).toBe(
      false,
    )
  })
})
