import { describe, it, expect } from 'vitest'
import type {
  AgentRunListItem,
  BriefingDispatchPreview,
} from '@goodparty_org/sdk'
import { describeBriefingPreview, hasActiveRun, isActiveRun } from './agentJobs'

const basePreview: BriefingDispatchPreview = {
  contextOk: true,
  isServeIcp: true,
  scheduleKnown: true,
  nextMeetingDate: null,
  imminentMeetingDate: null,
  coveredByBriefingDate: null,
  gateWouldDispatch: false,
  overrideWouldDispatch: true,
}

const run = (status: AgentRunListItem['status']): AgentRunListItem =>
  ({ runId: 'run_1', status }) as AgentRunListItem

describe('isActiveRun / hasActiveRun', () => {
  it('treats QUEUED, RUNNING and AWAITING_RESUME as active', () => {
    expect(isActiveRun(run('QUEUED'))).toBe(true)
    expect(isActiveRun(run('RUNNING'))).toBe(true)
    expect(isActiveRun(run('AWAITING_RESUME'))).toBe(true)
  })

  it('treats terminal statuses and null as inactive', () => {
    expect(isActiveRun(run('COMPLETED'))).toBe(false)
    expect(isActiveRun(run('FAILED'))).toBe(false)
    expect(isActiveRun(null)).toBe(false)
  })

  it('hasActiveRun is true when any run in the map is active', () => {
    expect(
      hasActiveRun({
        meeting_schedule: run('COMPLETED'),
        meeting_briefing: run('RUNNING'),
        top_community_issues: null,
        trending_issues: run('FAILED'),
      })
    ).toBe(true)
    expect(
      hasActiveRun({
        meeting_schedule: run('COMPLETED'),
        meeting_briefing: null,
        top_community_issues: null,
        trending_issues: run('FAILED'),
      })
    ).toBe(false)
    expect(hasActiveRun(null)).toBe(false)
  })
})

describe('describeBriefingPreview', () => {
  it('reports a gate dispatch with the imminent meeting date', () => {
    const view = describeBriefingPreview({
      ...basePreview,
      gateWouldDispatch: true,
      imminentMeetingDate: '2026-07-05',
    })
    expect(view.gateWouldDispatch).toBe(true)
    expect(view.message).toContain('Gate will dispatch')
    expect(view.message).toContain('Jul 5, 2026')
    expect(view.overrideDisabledReason).toBeNull()
  })

  it('explains a skip when the office is not serve-ICP', () => {
    const view = describeBriefingPreview({ ...basePreview, isServeIcp: false })
    expect(view.gateWouldDispatch).toBe(false)
    expect(view.message).toContain('not serve-ICP')
  })

  it('explains a skip when already covered by a briefing', () => {
    const view = describeBriefingPreview({
      ...basePreview,
      coveredByBriefingDate: '2026-06-30',
    })
    expect(view.message).toContain('already covered by a briefing')
    expect(view.message).toContain('Jun 30, 2026')
  })

  it('explains a skip when no schedule is known', () => {
    const view = describeBriefingPreview({
      ...basePreview,
      scheduleKnown: false,
    })
    expect(view.message).toContain('no meeting schedule known')
  })

  it('explains a skip when no meeting is within 3 days', () => {
    const view = describeBriefingPreview({
      ...basePreview,
      nextMeetingDate: '2026-08-01',
    })
    expect(view.message).toContain('no meeting within 3 days')
    expect(view.message).toContain('Aug 1, 2026')
  })

  it('disables override when it would find no meeting within 60 days', () => {
    const view = describeBriefingPreview({
      ...basePreview,
      overrideWouldDispatch: false,
    })
    expect(view.overrideDisabledReason).toContain('60 days')
  })

  it('disables override when context is not ok', () => {
    const view = describeBriefingPreview({ ...basePreview, contextOk: false })
    expect(view.overrideDisabledReason).toContain('Context is unavailable')
  })
})
