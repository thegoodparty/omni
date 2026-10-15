import { describe, expect, it } from 'vitest'
import {
  POLL_RESULTS_REFRESH_MS,
  pollHasSent,
  pollPhase,
  pollRefetchInterval,
} from './queries'

describe('pollRefetchInterval', () => {
  it('refreshes while the poll is in progress', () => {
    expect(pollRefetchInterval('in_progress', 'none')).toBe(
      POLL_RESULTS_REFRESH_MS,
    )
  })

  it('refreshes while a run is in flight, even once the poll is done', () => {
    expect(pollRefetchInterval('completed', 'running')).toBe(
      POLL_RESULTS_REFRESH_MS,
    )
  })

  it('stops once the poll is done with no run in flight', () => {
    expect(pollRefetchInterval('completed', 'completed')).toBe(false)
    expect(pollRefetchInterval('completed', 'failed')).toBe(false)
    expect(pollRefetchInterval('completed', 'none')).toBe(false)
  })

  it('does not refresh a poll that has not gone out', () => {
    expect(pollRefetchInterval('pending', undefined)).toBe(false)
    expect(pollRefetchInterval('approved', undefined)).toBe(false)
  })
})

describe('pollPhase', () => {
  it('reads results only once the poll has gone out', () => {
    expect(pollHasSent('in_progress')).toBe(true)
    expect(pollHasSent('completed')).toBe(true)
    expect(pollHasSent('pending')).toBe(false)
    expect(pollHasSent('approved')).toBe(false)
    expect(pollHasSent('denied')).toBe(false)
  })

  it('puts a poll held for review in review, not scheduled', () => {
    expect(pollPhase('pending')).toBe('review')
    expect(pollPhase('approved')).toBe('scheduled')
  })
})
