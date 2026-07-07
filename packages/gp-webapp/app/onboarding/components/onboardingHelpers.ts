import type {
  OnboardingStepConfig,
  NonEmptyArray,
  OnboardingAnswers,
  OnboardingStepId,
} from './onboardingTypes'

// Where the candidate lands after completing the pledge. Precedence:
// campaign-story (the Campaign Manager home at /dashboard — its chat greets
// with the story intake, so the manager walks them through the story there) >
// campaign-strategy (legacy LLM plan on the onboarding success page) > legacy
// dashboard. Story-on and story-off both resolve to /dashboard, but render
// different homes (Campaign Manager vs legacy widget) via the same flag. Pure
// so the precedence is unit-testable without driving the flow to the pledge.
export const resolvePostPledgeRoute = (flags: {
  campaignStoryEnabled: boolean
  campaignStrategyEnabled: boolean
}): string =>
  flags.campaignStoryEnabled
    ? '/dashboard'
    : flags.campaignStrategyEnabled
      ? '/onboarding/success'
      : '/dashboard'

export const getVisibleOnboardingSteps = (
  steps: NonEmptyArray<OnboardingStepConfig>,
  answers: OnboardingAnswers,
): NonEmptyArray<OnboardingStepConfig> => {
  const visible = steps.filter((step) => !step.shouldSkip?.({ answers }))
  const [firstVisible, ...remainingVisible] = visible

  return firstVisible ? [firstVisible, ...remainingVisible] : [steps[0]]
}

export const getNextOnboardingStep = (
  steps: NonEmptyArray<OnboardingStepConfig>,
  activeStepId: OnboardingStepId,
  answers: OnboardingAnswers,
): OnboardingStepConfig | null => {
  const visibleSteps = getVisibleOnboardingSteps(steps, answers)
  const activeIndex = visibleSteps.findIndex((step) => step.id === activeStepId)
  if (activeIndex === -1) {
    return null
  }

  return visibleSteps[activeIndex + 1] ?? null
}

export const getPreviousOnboardingStep = (
  steps: NonEmptyArray<OnboardingStepConfig>,
  activeStepId: OnboardingStepId,
  answers: OnboardingAnswers,
): OnboardingStepConfig | null => {
  const visibleSteps = getVisibleOnboardingSteps(steps, answers)
  const activeIndex = visibleSteps.findIndex((step) => step.id === activeStepId)
  return activeIndex > 0 ? (visibleSteps[activeIndex - 1] ?? null) : null
}
