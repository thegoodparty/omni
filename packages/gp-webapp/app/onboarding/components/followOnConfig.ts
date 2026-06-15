import type { OnboardingStepConfig, NonEmptyArray } from './onboardingTypes'
import { ONBOARDING_STEPS } from './onboardingConfig'

// The follow-on flow (org-switcher "run for re-election" / "run for a new
// office") reuses the standard onboarding steps but prepends an intent screen
// and skips the office picker when the candidate is running for the same
// office (the position is inherited server-side via fromOrganizationSlug).

const intentStep: OnboardingStepConfig = {
  id: 'intent',
  // The heading is rendered with the live office name by FollowOnFlow; this
  // is the fallback used only if no office name resolves.
  title: 'Are you running for re-election or a new office?',
  description:
    'Tell us whether this campaign is for the office you hold now or a different one.',
  // same-office inherits the held office via fromOrganizationSlug, so block
  // Continue without it (e.g. a direct ?intent=same-office URL with no ?from=)
  // rather than firing a request the server will 400 — the user can recover by
  // choosing new-office instead, since Back is disabled on this first step.
  isValid: ({ answers }) =>
    Boolean(answers.followOnIntent) &&
    (answers.followOnIntent !== 'same-office' ||
      Boolean(answers.fromOrganizationSlug)),
}

const sameOffice = ({
  answers,
}: {
  answers: { followOnIntent?: 'same-office' | 'new-office' }
}): boolean => answers.followOnIntent === 'same-office'

export const FOLLOW_ON_STEPS: NonEmptyArray<OnboardingStepConfig> = [
  intentStep,
  ...ONBOARDING_STEPS.map((step) => {
    if (step.id === 'welcome') {
      // The first-time welcome copy ("build your plan in 5 minutes") is wrong
      // for a returning candidate starting a follow-on campaign.
      return {
        ...step,
        title: "Let's set up your new campaign",
        description:
          "We'll reuse what we can from your record and build a fresh plan for this race.",
      }
    }
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
