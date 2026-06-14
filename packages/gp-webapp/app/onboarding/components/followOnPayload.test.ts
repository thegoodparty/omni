import { describe, expect, it } from 'vitest'
import { buildFollowOnPayload } from './followOnPayload'
import type { OnboardingAnswers } from './onboardingTypes'

describe('buildFollowOnPayload', () => {
  it('inherits the held office for same-office', () => {
    const answers: OnboardingAnswers = {
      followOnIntent: 'same-office',
      fromOrganizationSlug: 'eo-1',
    }
    expect(buildFollowOnPayload(answers)).toEqual({
      intent: 'same-office',
      fromOrganizationSlug: 'eo-1',
    })
  })

  it('passes the picked position for a structured new-office', () => {
    const answers: OnboardingAnswers = {
      followOnIntent: 'new-office',
      officePath: 'structured',
      structuredOffice: {
        raceId: 'race-9',
        positionId: 'pos-9',
        positionName: 'Mayor',
        state: 'CA',
        city: 'Springfield',
        electionDay: '2026-11-03',
        level: 'city',
      },
    }
    const payload = buildFollowOnPayload(answers)
    expect(payload.intent).toBe('new-office')
    expect(payload.ballotReadyPositionId).toBe('pos-9')
    expect(payload.details).toMatchObject({
      raceId: 'race-9',
      state: 'CA',
      city: 'Springfield',
      electionDate: '2026-11-03',
      ballotLevel: 'city',
    })
    // No held office is inherited on the new-office path.
    expect(payload.fromOrganizationSlug).toBeUndefined()
  })

  it('passes the custom office name for a manual new-office', () => {
    const answers: OnboardingAnswers = {
      followOnIntent: 'new-office',
      officePath: 'manual',
      manualOfficeForm: {
        office: 'Town Dogcatcher',
        state: 'CA',
        city: 'Springfield',
        district: 'District 5',
        officeTermLength: '4 years',
        electionDate: '2026-11-03',
      },
    }
    const payload = buildFollowOnPayload(answers)
    expect(payload.intent).toBe('new-office')
    expect(payload.customPositionName).toBe('Town Dogcatcher')
    expect(payload.ballotReadyPositionId).toBeUndefined()
    expect(payload.details).toMatchObject({
      raceId: null,
      state: 'CA',
      city: 'Springfield',
      district: 'District 5',
      electionDate: '2026-11-03',
    })
  })
})
