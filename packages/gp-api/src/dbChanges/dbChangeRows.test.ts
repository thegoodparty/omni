import { describe, expect, it } from 'vitest'
import { changeGroup, changeJobId } from './dbChangeRows'

describe('changeJobId', () => {
  it('sorts by change id, then by the entry’s place in its table', () => {
    const ids = [1n, 2n, 15n, 16n, 4096n, 65535n, 65536n].flatMap((changeId) =>
      [0, 1, 2].map((entryIndex) => changeJobId(changeId, entryIndex)),
    )
    expect([...ids].sort()).toEqual(ids)
  })

  it('is a uuid, so pg-boss accepts it as a job id', () => {
    expect(changeJobId(12345n, 3)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
  })

  it('is the same id for the same change and entry, so a resend inserts nothing', () => {
    expect(changeJobId(7n, 1)).toBe(changeJobId(7n, 1))
    expect(changeJobId(7n, 1)).not.toBe(changeJobId(7n, 2))
    expect(changeJobId(7n, 1)).not.toBe(changeJobId(8n, 1))
  })

  it('sorts change ids wider than 32 bits', () => {
    const big = 2n ** 48n
    expect(changeJobId(big, 0) < changeJobId(big + 1n, 0)).toBe(true)
  })

  it('keeps a table’s entries in the order the registry lists them', () => {
    const changeId = 9_999_999n
    expect(
      [0, 1, 2].map((index) => changeJobId(changeId, index)).sort(),
    ).toEqual([0, 1, 2].map((index) => changeJobId(changeId, index)))
  })
})

describe('changeGroup', () => {
  it('distinguishes rows of one table and matches a row across writes', () => {
    expect(changeGroup('campaign', { id: 1 })).toBe('campaign:{"id":1}')
    expect(changeGroup('campaign', { id: 1 })).not.toBe(
      changeGroup('campaign', { id: 2 }),
    )
    expect(changeGroup('campaign', { id: 1 })).not.toBe(
      changeGroup('website', { id: 1 }),
    )
  })
})
