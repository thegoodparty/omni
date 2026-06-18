import { describe, it, expect, vi, beforeEach } from 'vitest'

const { trackEvent } = vi.hoisted(() => ({ trackEvent: vi.fn() }))

vi.mock('helpers/analyticsHelper', () => ({
  EVENTS: {
    ServeOnboarding: {
      LinkActivated: 'Serve Onboarding - Magic Link Activated',
      NetNewCompleted: 'Serve Onboarding - Net New Completed',
      BrSuggestionChanged: 'Serve Onboarding - BR Suggestion Changed',
    },
  },
  trackEvent,
}))

import {
  buildBrSuggestionChangedPayload,
  trackServeOnboarding,
  SERVE_ONBOARDING_EVENTS,
} from './serveOnboardingAnalytics'

const BR_POSITION = 'br-position-mayor'
const OTHER_POSITION = 'br-position-council'

const prefill = {
  positionId: BR_POSITION,
  positionName: 'Mayor of Springfield',
  termStartDate: '2025-01-01',
  termEndDate: '2029-01-01',
  officeholderPositionIds: [BR_POSITION],
}

describe('buildBrSuggestionChangedPayload', () => {
  it('keeps the suggested office: changedField=termDates, matched officeholder', () => {
    const payload = buildBrSuggestionChangedPayload({
      electedOfficeId: 'eo-1',
      prefill,
      selected: {
        positionId: BR_POSITION,
        positionName: 'Mayor of Springfield',
        termStartDate: '2025-01-01',
        termEndDate: '2030-01-01',
      },
    })

    expect(payload).toMatchObject({
      electedOfficeId: 'eo-1',
      hadBrPrefill: true,
      changedField: 'termDates',
      fromPositionId: BR_POSITION,
      toPositionId: BR_POSITION,
      fromTermEndDate: '2029-01-01',
      toTermEndDate: '2030-01-01',
      matchedBrOfficeholder: true,
    })
  })

  it('changes office to a non-BR-officeholder position: matched=false', () => {
    const payload = buildBrSuggestionChangedPayload({
      electedOfficeId: 'eo-1',
      prefill,
      selected: {
        positionId: OTHER_POSITION,
        positionName: 'City Council, Ward 3',
        termStartDate: '2025-01-01',
        termEndDate: '2029-01-01',
      },
    })

    expect(payload.changedField).toBe('office')
    expect(payload.fromPositionId).toBe(BR_POSITION)
    expect(payload.toPositionId).toBe(OTHER_POSITION)
    expect(payload.matchedBrOfficeholder).toBe(false)
  })

  it('matches when the final pick is in a multi-position officeholder set', () => {
    const payload = buildBrSuggestionChangedPayload({
      electedOfficeId: 'eo-1',
      prefill: {
        ...prefill,
        officeholderPositionIds: [BR_POSITION, OTHER_POSITION],
      },
      selected: {
        positionId: OTHER_POSITION,
        positionName: 'City Council, Ward 3',
        termStartDate: '2025-01-01',
        termEndDate: '2029-01-01',
      },
    })

    expect(payload.changedField).toBe('office')
    expect(payload.matchedBrOfficeholder).toBe(true)
  })

  it('reports both when office and term dates change', () => {
    const payload = buildBrSuggestionChangedPayload({
      electedOfficeId: 'eo-1',
      prefill,
      selected: {
        positionId: OTHER_POSITION,
        positionName: 'City Council, Ward 3',
        termStartDate: '2026-01-01',
        termEndDate: '2030-01-01',
      },
    })

    expect(payload.changedField).toBe('both')
    expect(payload.matchedBrOfficeholder).toBe(false)
  })

  it('reports changedField=null when the user keeps the exact suggestion', () => {
    const payload = buildBrSuggestionChangedPayload({
      electedOfficeId: 'eo-1',
      prefill,
      selected: {
        positionId: BR_POSITION,
        positionName: 'Mayor of Springfield',
        termStartDate: '2025-01-01',
        termEndDate: '2029-01-01',
      },
    })

    expect(payload.changedField).toBeNull()
    expect(payload.matchedBrOfficeholder).toBe(true)
  })

  it('handles the no-BR-prefill (net-new) case', () => {
    const payload = buildBrSuggestionChangedPayload({
      electedOfficeId: 'eo-2',
      prefill: null,
      selected: {
        positionId: OTHER_POSITION,
        positionName: 'City Council, Ward 3',
        termStartDate: '2025-01-01',
        termEndDate: '2029-01-01',
      },
    })

    expect(payload).toMatchObject({
      hadBrPrefill: false,
      changedField: 'both',
      fromPositionId: null,
      fromPositionName: null,
      fromTermStartDate: null,
      fromTermEndDate: null,
      toPositionId: OTHER_POSITION,
      matchedBrOfficeholder: false,
    })
  })

  it('diffs custom offices by name when neither side has a BR id', () => {
    const payload = buildBrSuggestionChangedPayload({
      prefill: {
        positionName: 'Mayor (custom)',
        termStartDate: '2025-01-01',
        termEndDate: '2029-01-01',
      },
      selected: {
        positionName: 'Town Supervisor',
        termStartDate: '2025-01-01',
        termEndDate: '2029-01-01',
      },
    })

    expect(payload.changedField).toBe('office')
    expect(payload.fromPositionId).toBeNull()
    expect(payload.toPositionId).toBeNull()
    expect(payload.matchedBrOfficeholder).toBe(false)
  })
})

describe('trackServeOnboarding', () => {
  beforeEach(() => trackEvent.mockClear())

  it('forwards the enriched payload to trackEvent', () => {
    const payload = buildBrSuggestionChangedPayload({
      electedOfficeId: 'eo-1',
      prefill,
      selected: {
        positionId: OTHER_POSITION,
        positionName: 'City Council, Ward 3',
        termStartDate: '2025-01-01',
        termEndDate: '2029-01-01',
      },
    })

    trackServeOnboarding(SERVE_ONBOARDING_EVENTS.SuggestionChanged, payload)

    expect(trackEvent).toHaveBeenCalledWith(
      'Serve Onboarding - BR Suggestion Changed',
      expect.objectContaining({
        changedField: 'office',
        matchedBrOfficeholder: false,
        toPositionId: OTHER_POSITION,
      }),
    )
  })
})
