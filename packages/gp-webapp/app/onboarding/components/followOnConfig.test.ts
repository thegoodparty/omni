import { describe, expect, it } from 'vitest'
import { FOLLOW_ON_STEPS, firstFollowOnStepId } from './followOnConfig'
import { getVisibleOnboardingSteps } from './onboardingHelpers'

const visibleIds = (answers: Parameters<typeof getVisibleOnboardingSteps>[1]) =>
  getVisibleOnboardingSteps(FOLLOW_ON_STEPS, answers).map((step) => step.id)

describe('followOnConfig', () => {
  it('starts on the welcome step (no intent screen)', () => {
    expect(firstFollowOnStepId).toBe('welcome')
  })

  it('skips the office picker (and manual entry) for same-office', () => {
    const ids = visibleIds({ followOnIntent: 'same-office' })
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
