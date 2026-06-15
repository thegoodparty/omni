import { describe, expect, it } from 'vitest'
import { FOLLOW_ON_STEPS, firstFollowOnStepId } from './followOnConfig'
import { getVisibleOnboardingSteps } from './onboardingHelpers'

const visibleIds = (answers: Parameters<typeof getVisibleOnboardingSteps>[1]) =>
  getVisibleOnboardingSteps(FOLLOW_ON_STEPS, answers).map((step) => step.id)

describe('followOnConfig', () => {
  it('starts on the intent step', () => {
    expect(firstFollowOnStepId).toBe('intent')
  })

  it('requires fromOrganizationSlug before same-office can continue', () => {
    const intentStep = FOLLOW_ON_STEPS[0]
    expect(intentStep.isValid?.({ answers: {} })).toBe(false)
    // same-office with no held-office slug must not advance (would 400).
    expect(
      intentStep.isValid?.({ answers: { followOnIntent: 'same-office' } }),
    ).toBe(false)
    expect(
      intentStep.isValid?.({
        answers: {
          followOnIntent: 'same-office',
          fromOrganizationSlug: 'eo-1',
        },
      }),
    ).toBe(true)
    // new-office never needs a slug.
    expect(
      intentStep.isValid?.({ answers: { followOnIntent: 'new-office' } }),
    ).toBe(true)
  })

  it('skips the office picker (and manual entry) for same-office', () => {
    const ids = visibleIds({ followOnIntent: 'same-office' })
    expect(ids).toContain('intent')
    expect(ids).not.toContain('office-selection')
    expect(ids).not.toContain('manual-office-entry')
    // Inherited-position path still runs the projection + insights steps.
    expect(ids).toContain('path-to-victory')
    expect(ids).toContain('voter-demographics')
    expect(ids).toContain('pledge')
  })

  it('includes the office picker for new-office', () => {
    const ids = visibleIds({ followOnIntent: 'new-office' })
    expect(ids).toContain('office-selection')
  })

  it('shows manual entry on the new-office manual path only', () => {
    expect(
      visibleIds({ followOnIntent: 'new-office', officePath: 'manual' }),
    ).toContain('manual-office-entry')
    expect(
      visibleIds({ followOnIntent: 'new-office', officePath: 'structured' }),
    ).not.toContain('manual-office-entry')
  })
})
