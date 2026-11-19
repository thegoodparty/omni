import { describe, expect, it } from 'vitest'
import { outreachHasGoneOut } from './OutreachGoneOut'

const TODAY = '2026-10-22'

describe('outreachHasGoneOut', () => {
  it('holds a paid text in progress until its scheduled day', () => {
    expect(
      outreachHasGoneOut(
        { status: 'in_progress', scheduledFor: '2026-10-27' },
        TODAY,
      ),
    ).toBe(false)
  })

  it('counts a text in progress as out from its scheduled day on', () => {
    expect(
      outreachHasGoneOut({ status: 'in_progress', scheduledFor: TODAY }, TODAY),
    ).toBe(true)
    expect(
      outreachHasGoneOut(
        { status: 'in_progress', scheduledFor: '2026-10-20' },
        TODAY,
      ),
    ).toBe(true)
  })

  it('counts a completed send as out whatever its day', () => {
    expect(
      outreachHasGoneOut(
        { status: 'completed', scheduledFor: '2026-10-27' },
        TODAY,
      ),
    ).toBe(true)
    expect(
      outreachHasGoneOut({ status: 'completed', scheduledFor: null }, TODAY),
    ).toBe(true)
  })

  it('counts a send in progress with no day as out', () => {
    expect(
      outreachHasGoneOut({ status: 'in_progress', scheduledFor: null }, TODAY),
    ).toBe(true)
  })

  it('never counts a send waiting on its day or on payment as out', () => {
    for (const status of ['pending', 'paid', 'pending_payment'] as const) {
      expect(
        outreachHasGoneOut({ status, scheduledFor: '2026-10-20' }, TODAY),
      ).toBe(false)
    }
    expect(
      outreachHasGoneOut({ status: null, scheduledFor: '2026-10-20' }, TODAY),
    ).toBe(false)
  })
})
