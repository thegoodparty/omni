import { describe, expect, it } from 'vitest'
import { alertedRecently, shouldAlert, type Artifact } from './pickerFailures'

const artifact = (createdAt: string, expired = false): Artifact => ({
  created_at: createdAt,
  expired,
})

describe('shouldAlert', () => {
  it('does not alert on a single failure artifact', () => {
    expect(
      shouldAlert(
        [artifact('2026-11-01T00:00:00.000Z')],
        new Date('2026-11-01T00:00:00.000Z'),
      ),
    ).toBe(false)
  })

  it('alerts when two failure artifacts fall within the trailing 7 days', () => {
    const artifacts = [
      artifact('2026-11-01T00:00:00.000Z'),
      artifact('2026-11-03T00:00:00.000Z'),
    ]
    expect(shouldAlert(artifacts, new Date('2026-11-03T00:00:00.000Z'))).toBe(
      true,
    )
  })

  it('does not alert when two failure artifacts are 8+ days apart', () => {
    const artifacts = [
      artifact('2026-11-01T00:00:00.000Z'),
      artifact('2026-11-09T00:00:00.000Z'),
    ]
    expect(shouldAlert(artifacts, new Date('2026-11-09T00:00:00.000Z'))).toBe(
      false,
    )
  })

  it('ignores an expired artifact even if its timestamp is in the window', () => {
    const artifacts = [
      artifact('2026-11-01T00:00:00.000Z'),
      artifact('2026-11-03T00:00:00.000Z', true),
    ]
    expect(shouldAlert(artifacts, new Date('2026-11-03T00:00:00.000Z'))).toBe(
      false,
    )
  })
})

describe('alertedRecently', () => {
  it('is false with no alert artifacts', () => {
    expect(alertedRecently([], new Date('2026-11-05T00:00:00.000Z'))).toBe(
      false,
    )
  })

  it('is true when an alert landed within the last 24 hours', () => {
    const artifacts = [artifact('2026-11-04T18:00:00.000Z')]
    expect(
      alertedRecently(artifacts, new Date('2026-11-05T00:00:00.000Z')),
    ).toBe(true)
  })

  it('is false once the last alert is more than 24 hours old', () => {
    const artifacts = [artifact('2026-11-03T00:00:00.000Z')]
    expect(
      alertedRecently(artifacts, new Date('2026-11-05T00:00:00.000Z')),
    ).toBe(false)
  })
})
