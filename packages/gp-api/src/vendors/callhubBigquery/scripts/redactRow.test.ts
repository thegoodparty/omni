import { describe, expect, it } from 'vitest'
import { REDACTED, isSensitiveColumn, redactRow } from './redactRow'

describe('isSensitiveColumn', () => {
  it.each([
    'phone',
    'phone_number',
    'Phone',
    'CALLER_ID',
    'callee',
    'msisdn',
    'mobile_number',
    'cell',
    'contact_number',
    'dialed_number',
  ])('flags %s as sensitive', (name) => {
    expect(isSensitiveColumn(name)).toBe(true)
  })

  it.each(['campaign_id', 'disposition', 'call_status', 'created_at', 'state'])(
    'passes %s through',
    (name) => {
      expect(isSensitiveColumn(name)).toBe(false)
    },
  )
})

describe('redactRow', () => {
  it('masks sensitive columns and leaves the rest untouched', () => {
    const row = {
      campaign_id: 'vb_123',
      phone_number: '+15551234567',
      disposition: 'connected',
      caller_id: '+15559999999',
      duration_seconds: 42,
    }
    expect(redactRow(row)).toEqual({
      campaign_id: 'vb_123',
      phone_number: REDACTED,
      disposition: 'connected',
      caller_id: REDACTED,
      duration_seconds: 42,
    })
  })

  it('returns an equivalent row when nothing is sensitive', () => {
    const row = { campaign_id: 'vb_9', disposition: 'busy' }
    expect(redactRow(row)).toEqual(row)
  })
})
