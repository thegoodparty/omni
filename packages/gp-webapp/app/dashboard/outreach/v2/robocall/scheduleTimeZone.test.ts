import { describe, expect, it } from 'vitest'
import {
  combineScheduledAt,
  DEFAULT_TIME_ZONE,
  resolveCampaignTimeZone,
  timeZoneShortLabel,
  zonedCalendarDay,
} from './scheduleTimeZone'

describe('resolveCampaignTimeZone', () => {
  it('maps a state to its predominant IANA zone', () => {
    expect(resolveCampaignTimeZone('CA')).toBe('America/Los_Angeles')
    expect(resolveCampaignTimeZone('TX')).toBe('America/Chicago')
    expect(resolveCampaignTimeZone('AZ')).toBe('America/Phoenix')
  })

  it('is case-insensitive', () => {
    expect(resolveCampaignTimeZone('ny')).toBe('America/New_York')
  })

  it('falls back to Eastern for missing or unknown states', () => {
    expect(resolveCampaignTimeZone(undefined)).toBe(DEFAULT_TIME_ZONE)
    expect(resolveCampaignTimeZone(null)).toBe(DEFAULT_TIME_ZONE)
    expect(resolveCampaignTimeZone('ZZ')).toBe(DEFAULT_TIME_ZONE)
    expect(DEFAULT_TIME_ZONE).toBe('America/New_York')
  })
})

describe('combineScheduledAt', () => {
  it('returns null until both a day and a time are chosen', () => {
    expect(
      combineScheduledAt(undefined, '10:00', 'America/New_York'),
    ).toBeNull()
    expect(
      combineScheduledAt(new Date(2026, 8, 5), '', 'America/New_York'),
    ).toBeNull()
  })

  it('resolves a wall-clock day+time in the zone to the right UTC instant', () => {
    // 10:00 on 2026-09-05 in Eastern is EDT (UTC-4) => 14:00Z.
    expect(
      combineScheduledAt(
        new Date(2026, 8, 5),
        '10:00',
        'America/New_York',
      )?.toISOString(),
    ).toBe('2026-09-05T14:00:00.000Z')
    // Same wall clock in Pacific is PDT (UTC-7) => 17:00Z.
    expect(
      combineScheduledAt(
        new Date(2026, 8, 5),
        '10:00',
        'America/Los_Angeles',
      )?.toISOString(),
    ).toBe('2026-09-05T17:00:00.000Z')
  })

  it('accounts for DST — a winter Eastern time is EST (UTC-5)', () => {
    expect(
      combineScheduledAt(
        new Date(2026, 0, 10),
        '09:00',
        'America/New_York',
      )?.toISOString(),
    ).toBe('2026-01-10T14:00:00.000Z')
  })
})

describe('zonedCalendarDay', () => {
  it('returns the calendar day the instant falls on in the given zone', () => {
    // 02:00Z on the 6th is still the 5th at 22:00 in Eastern (EDT).
    const day = zonedCalendarDay(
      new Date('2026-09-06T02:00:00Z'),
      'America/New_York',
    )
    expect(day.getFullYear()).toBe(2026)
    expect(day.getMonth()).toBe(8)
    expect(day.getDate()).toBe(5)
  })
})

describe('timeZoneShortLabel', () => {
  it('reflects DST at the given instant', () => {
    expect(
      timeZoneShortLabel('America/New_York', new Date('2026-09-01T12:00:00Z')),
    ).toBe('EDT')
    expect(
      timeZoneShortLabel('America/New_York', new Date('2026-01-10T12:00:00Z')),
    ).toBe('EST')
  })
})
