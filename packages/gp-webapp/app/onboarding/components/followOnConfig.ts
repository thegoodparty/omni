import type { OnboardingStepConfig, NonEmptyArray } from './onboardingTypes'
import { ONBOARDING_STEPS } from './onboardingConfig'

// The follow-on flow (org-switcher "run for re-election" / "run for a new
// office") reuses the standard onboarding steps. Which switcher action the user
// picked is the intent — it arrives as the `intent` query param — so there is
// no intent screen. Re-election runs the same-office path (office picker
// skipped, position inherited server-side via fromOrganizationSlug); "new
// office" runs the new-office path (office picker shown).

const sameOffice = ({
  answers,
}: {
  answers: { followOnIntent?: 'same-office' | 'new-office' }
}): boolean => answers.followOnIntent === 'same-office'

// welcome is always the first onboarding step; keep it the literal head of the
// tuple so FOLLOW_ON_STEPS stays a NonEmptyArray (mapping a tuple widens it to
// a plain array and loses that guarantee).
const [welcomeStep, ...laterSteps] = ONBOARDING_STEPS

export const FOLLOW_ON_STEPS: NonEmptyArray<OnboardingStepConfig> = [
  {
    ...welcomeStep,
    // The first-time welcome copy ("build your plan in 5 minutes") is wrong
    // for a returning candidate starting a follow-on campaign.
    title: "Let's set up your new campaign",
    description:
      "We'll reuse what we can from your record and build a fresh plan for this race.",
  },
  ...laterSteps.map((step) => {
    if (step.id === 'office-selection') {
      return { ...step, shouldSkip: sameOffice }
    }
    if (step.id === 'manual-office-entry') {
      const skipManual = step.shouldSkip
      return {
        ...step,
        // Keep the manual-entry-only skip and add the same-office skip.
        shouldSkip: (context: Parameters<typeof sameOffice>[0]) =>
          sameOffice(context) || Boolean(skipManual?.(context)),
      }
    }
    return step
  }),
]

export const firstFollowOnStepId = FOLLOW_ON_STEPS[0].id
