import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SEND_WINDOW_TIMEZONE,
  resolveSendWindowTimeZone,
} from './sendWindowTimeZone.util'

describe('resolveSendWindowTimeZone', () => {
  it('maps a state to its predominant zone in the form Peerly documents', () => {
    expect(resolveSendWindowTimeZone('CA')).toBe('US/Pacific')
    expect(resolveSendWindowTimeZone('TX')).toBe('US/Central')
    expect(resolveSendWindowTimeZone('CO')).toBe('US/Mountain')
    expect(resolveSendWindowTimeZone('AZ')).toBe('US/Arizona')
    expect(resolveSendWindowTimeZone('NY')).toBe('US/Eastern')
  })

  it('tolerates case and whitespace', () => {
    expect(resolveSendWindowTimeZone(' ny ')).toBe('US/Eastern')
  })

  it('falls back to Eastern for a missing or unmapped state', () => {
    expect(resolveSendWindowTimeZone(undefined)).toBe(
      DEFAULT_SEND_WINDOW_TIMEZONE,
    )
    expect(resolveSendWindowTimeZone(null)).toBe(DEFAULT_SEND_WINDOW_TIMEZONE)
    expect(resolveSendWindowTimeZone('USA')).toBe(DEFAULT_SEND_WINDOW_TIMEZONE)
    expect(DEFAULT_SEND_WINDOW_TIMEZONE).toBe('US/Eastern')
  })
})
