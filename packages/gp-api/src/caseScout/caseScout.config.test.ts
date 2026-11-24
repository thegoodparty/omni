import { afterEach, describe, expect, it, vi } from 'vitest'
import { firstNightWindowHours, nightlyCapOverride } from './caseScout.config'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('nightlyCapOverride', () => {
  it.each([
    ['10', 10],
    ['1', 1],
    ['25', 25],
    ['', undefined],
    ['0', undefined],
    ['26', undefined],
    ['2.5', undefined],
    ['ten', undefined],
  ])('reads CASE_SCOUT_NIGHTLY_CAP=%j as %j', (value, expected) => {
    vi.stubEnv('CASE_SCOUT_NIGHTLY_CAP', value)
    expect(nightlyCapOverride()).toBe(expected)
  })

  it('leaves the ladder in charge when unset', () => {
    delete process.env.CASE_SCOUT_NIGHTLY_CAP
    expect(nightlyCapOverride()).toBeUndefined()
  })
})

describe('firstNightWindowHours', () => {
  it.each([
    ['168', 168],
    ['1', 1],
    ['336', 336],
    ['', 24],
    ['0', 24],
    ['337', 24],
    ['-5', 24],
    ['a week', 24],
  ])(
    'reads CASE_SCOUT_FIRST_NIGHT_WINDOW_HOURS=%j as %j',
    (value, expected) => {
      vi.stubEnv('CASE_SCOUT_FIRST_NIGHT_WINDOW_HOURS', value)
      expect(firstNightWindowHours()).toBe(expected)
    },
  )
})
