import { describe, it, expect } from 'vitest'
import type { ElectedOffice } from 'gpApi/api-endpoints'
import {
  buildDisabledRanges,
  overlapsExisting,
  FAR_FUTURE,
} from './termDates.shared'

const office = (
  id: string,
  termStartDate: string | null,
  termEndDate: string | null,
): ElectedOffice =>
  ({ id, termStartDate, termEndDate }) as unknown as ElectedOffice

describe('buildDisabledRanges', () => {
  it('excludes the office being edited', () => {
    const ranges = buildDisabledRanges(
      [office('self', '2025-01-01', '2029-01-01')],
      'self',
    )
    expect(ranges).toHaveLength(0)
  })

  it('skips a null-start office (non-comparable) so the UI matches the server', () => {
    // Partial BallotReady prefill (null start, real end) and an all-null
    // placeholder are both non-comparable on the server; neither should block
    // dates in the picker.
    const ranges = buildDisabledRanges(
      [office('a', null, '2029-01-01'), office('b', null, null)],
      undefined,
    )
    expect(ranges).toHaveLength(0)
  })

  it('blocks a null-end (indefinite) term from its start onward', () => {
    const ranges = buildDisabledRanges(
      [office('a', '2020-01-01', null)],
      undefined,
    )
    expect(ranges).toEqual([{ from: new Date(2020, 0, 1), to: FAR_FUTURE }])
  })
})

describe('overlapsExisting alignment with the server', () => {
  it('does not flag a term against a skipped null-start office', () => {
    const ranges = buildDisabledRanges(
      [office('a', null, '2029-01-01')],
      undefined,
    )
    expect(
      overlapsExisting(new Date(2025, 0, 1), new Date(2028, 0, 1), ranges),
    ).toBe(false)
  })

  it('flags a genuine overlap with a fully-dated office', () => {
    const ranges = buildDisabledRanges(
      [office('a', '2025-01-01', '2029-01-01')],
      undefined,
    )
    expect(
      overlapsExisting(new Date(2028, 0, 1), new Date(2030, 0, 1), ranges),
    ).toBe(true)
  })

  it('treats consecutive half-open terms (end === next start) as non-overlapping', () => {
    const ranges = buildDisabledRanges(
      [office('a', '2021-01-01', '2025-01-01')],
      undefined,
    )
    expect(
      overlapsExisting(new Date(2025, 0, 1), new Date(2029, 0, 1), ranges),
    ).toBe(false)
  })
})
