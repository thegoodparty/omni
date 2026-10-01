import { describe, expect, it } from 'vitest'
import { parseArgs } from './backfill-campaign-plans'

// The entrypoint is guarded by `require.main === module`, so importing the
// script here does not open Prisma or boot the Nest graph.
describe('backfill-campaign-plans parseArgs', () => {
  it('defaults to a dry run over every eligible campaign', () => {
    expect(parseArgs([])).toEqual({ apply: false, limit: null })
  })

  it('takes --apply and --limit together', () => {
    expect(parseArgs(['--limit', '10', '--apply'])).toEqual({
      apply: true,
      limit: 10,
    })
  })

  // A typo'd flag must not silently become a full-population dispatch.
  it('rejects an unknown flag', () => {
    expect(() => parseArgs(['--dry-run'])).toThrow(/Unknown argument/)
  })

  it.each([['0'], ['-5'], ['abc'], ['1.5']])(
    'rejects --limit %s',
    (value: string) => {
      expect(() => parseArgs(['--limit', value])).toThrow(
        /--limit needs a positive integer/,
      )
    },
  )

  it('rejects --limit with no value', () => {
    expect(() => parseArgs(['--limit'])).toThrow(
      /--limit needs a positive integer/,
    )
  })
})
