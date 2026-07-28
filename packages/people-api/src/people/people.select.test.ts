import { describe, expect, it } from 'vitest'
import { DOWNLOAD_COLUMNS, EXCLUDABLE_VOTER_COLUMNS } from './people.select'

describe('EXCLUDABLE_VOTER_COLUMNS', () => {
  // The `satisfies readonly DownloadColumn[]` pin already makes this a
  // compile-time guarantee (a typo fails `tsc`, not just this test). This is
  // a regression tripwire: if the pin is ever loosened back to a wider type,
  // this still catches an excludable column that doesn't exist in the
  // download projection.
  it('every entry matches a DOWNLOAD_COLUMNS.column', () => {
    const downloadColumnNames = new Set(
      DOWNLOAD_COLUMNS.map(({ column }) => column as string),
    )

    for (const excludable of EXCLUDABLE_VOTER_COLUMNS) {
      expect(downloadColumnNames.has(excludable)).toBe(true)
    }
  })
})
