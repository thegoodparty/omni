import { beforeEach, describe, expect, it } from 'vitest'
import {
  ELECTION_RESULT_SNOOZE_MS,
  clearElectionResultShown,
  clearElectionResultSnooze,
  isElectionResultSnoozed,
  markElectionResultShown,
  snoozeElectionResult,
  wasElectionResultShown,
} from './dismissal'

describe('election result snooze', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('hides the question for this campaign for 3 days', () => {
    const now = Date.UTC(2026, 10, 4)
    snoozeElectionResult(9, now)

    expect(isElectionResultSnoozed(9, now + 1)).toBe(true)
    expect(isElectionResultSnoozed(9, now + ELECTION_RESULT_SNOOZE_MS)).toBe(
      false,
    )
  })

  it('still asks about another campaign', () => {
    snoozeElectionResult(9)

    expect(isElectionResultSnoozed(10)).toBe(false)
    expect(isElectionResultSnoozed(undefined)).toBe(false)
  })

  it('asks again once cleared', () => {
    snoozeElectionResult(9)
    clearElectionResultSnooze()

    expect(isElectionResultSnoozed(9)).toBe(false)
  })
})

describe('election result shown this session', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
  })

  it('remembers the campaign it was shown to', () => {
    expect(wasElectionResultShown(9)).toBe(false)
    markElectionResultShown(9)

    expect(wasElectionResultShown(9)).toBe(true)
    expect(wasElectionResultShown(10)).toBe(false)
    expect(wasElectionResultShown(undefined)).toBe(false)
  })

  it('shows it again once cleared', () => {
    markElectionResultShown(9)
    clearElectionResultShown()

    expect(wasElectionResultShown(9)).toBe(false)
  })
})
