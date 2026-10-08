import { describe, expect, it } from 'vitest'
import { UnpinnableSqlError, assertDeltaVersion } from './deltaVersion'

describe('assertDeltaVersion', () => {
  it('accepts a whole number', () => {
    expect(() => assertDeltaVersion('3237')).not.toThrow()
  })

  it('refuses a version that is not a whole number', () => {
    expect(() =>
      assertDeltaVersion('1 WHERE 1=1 UNION SELECT Voters_FirstName'),
    ).toThrow(UnpinnableSqlError)
    expect(() => assertDeltaVersion('-1')).toThrow(UnpinnableSqlError)
    expect(() => assertDeltaVersion('')).toThrow(UnpinnableSqlError)
  })
})
