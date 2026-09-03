import { describe, expect, it } from 'vitest'
import {
  ROBOCALL_BROADCAST_STATUS,
  RobocallBroadcastStatus,
} from './robocallVendor.types'

describe('ROBOCALL_BROADCAST_STATUS', () => {
  it('is the exact neutral lifecycle set the state machines switch on', () => {
    expect(Object.values(ROBOCALL_BROADCAST_STATUS).sort()).toEqual(
      [
        'aborted',
        'completed',
        'dialing',
        'paused',
        'pending',
        'unknown',
      ].sort(),
    )
  })

  it('carries unknown as the deliberate unresolved fallback', () => {
    expect(ROBOCALL_BROADCAST_STATUS.UNKNOWN).toBe('unknown')
  })

  it('assigns each enum value to the RobocallBroadcastStatus union', () => {
    const values: RobocallBroadcastStatus[] = Object.values(
      ROBOCALL_BROADCAST_STATUS,
    )
    expect(values).toContain(ROBOCALL_BROADCAST_STATUS.PENDING)
  })
})
