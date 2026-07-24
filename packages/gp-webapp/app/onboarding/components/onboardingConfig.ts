import type { OnboardingStepConfig, NonEmptyArray } from './onboardingTypes'

// Shared "Why we ask" aside copy for all three story steps (rendered in the
// right-hand WhyThisMatters panel).
const STORY_WHY_WE_ASK =
  "We use all of this to personalize and craft your outreach so you don't have to, and to build you a personalized campaign plan. You can skip this and add it later, but the more you tell me now, the sharper your first plan will be."

export const ONBOARDING_STEPS: NonEmptyArray<OnboardingStepConfig> = [
  {
    id: 'welcome',
    title: "Let's build your winning campaign plan in 5 minutes",
    description:
      "All we need to know is what office you're running for. We'll take it from there.",
  },
  {
    id: 'ballot-status',
    title: 'Are you already on the ballot?',
    description:
      'We tailor your strategy to where you actually are in your campaign.',
    whyThisMatters:
      'Knowing whether you’re already on the ballot lets us tailor your timeline and the next steps in your campaign plan.',
    isValid: ({ answers }) => Boolean(answers.ballotStatus),
  },
  {
    id: 'party-affiliation',
    title: 'Are you running with an official party designation?',
    description:
      'Pick the party label voters would see on their official ballots for you as a candidate, not your personal voting history or party preference.',
    whyThisMatters:
      'GoodParty.org only works with non-partisan candidates or those who are independent of both major parties and big money, so they can run, win and serve empowered by our verifiably anti-corrupt platform.',
    isValid: ({ answers }) =>
      answers.partyAffiliation === 'nonpartisan' ||
      answers.partyAffiliation === 'independent-or-non-major',
  },
  {
    id: 'office-selection',
    title: 'What office are you running for?',
    description:
      "We'll use this to pull local voter data and shape your plan around your race.",
    whyThisMatters:
      "We use this to find the district you're running in, pull registered voter data, historical voter turnout, partisan data, and local issues to build your campaign plan.",
    isValid: ({ answers }) =>
      Boolean(answers.structuredOffice) || answers.officePath === 'manual',
  },
  {
    id: 'manual-office-entry',
    title: 'Tell us about your office',
    description:
      "We couldn't find a structured match. Enter your office details and our team will follow up.",
    whyThisMatters:
      'We capture your office details manually so we can still generate a tailored campaign plan, even without structured election data.',
    shouldSkip: ({ answers }) => answers.officePath !== 'manual',
    isValid: ({ answers }) => {
      const f = answers.manualOfficeForm
      if (!f) return false
      const validTermLengths = ['2 years', '3 years', '4 years', '6 years']
      if (
        !(
          f.office &&
          f.state &&
          f.city &&
          f.officeTermLength &&
          validTermLengths.includes(f.officeTermLength) &&
          f.electionDate
        )
      ) {
        return false
      }
      const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(f.electionDate)
      const parsed = match
        ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
        : new Date(f.electionDate)
      if (Number.isNaN(parsed.getTime())) return false
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      parsed.setHours(0, 0, 0, 0)
      return parsed >= today
    },
  },
  {
    id: 'path-to-victory',
    title: 'Projected votes needed to win',
    description:
      'We use historical voter data and proprietary models to get the most accurate projections for your race.',
    whyThisMatters:
      "Most candidates think they need to convince everyone. You don't. You need to find your win number, talk to them, and make sure they vote. We'll show you exactly what that takes.",
    shouldSkip: ({ answers }) => answers.officePath === 'manual',
  },
  // The Campaign Story is split into three skippable steps (why → background →
  // voter issues). Continue always advances; Skip on any of them skips ALL three
  // and jumps to the pledge, and the answers are persisted only on the final
  // step's Continue — see OnboardingFlow's handleStoryContinue / handleStorySkip.
  // Each renders the standard onboarding chrome (page heading + description +
  // "Why we ask" aside) around its card.
  {
    id: 'campaign-story-why',
    title: 'Why are you running?',
    description:
      "We'll use this to draft your voter outreach and personalize your campaign plan.",
    whyThisMatters: STORY_WHY_WE_ASK,
    isValid: () => true,
  },
  {
    id: 'campaign-story-background',
    title: "What's your background?",
    description:
      'A bit about who you are and what shaped you — we weave it into your outreach.',
    whyThisMatters: STORY_WHY_WE_ASK,
    isValid: () => true,
  },
  {
    id: 'campaign-story-issues',
    title: 'What issues do you most want to solve if elected?',
    description:
      'Add each policy priority as its own entry — a short title and the story behind it.',
    whyThisMatters:
      'We use each priority to draft targeted outreach and shape your campaign plan. Add as many as matter to you — you can always edit or remove them later.',
    isValid: () => true,
  },
  {
    id: 'pledge',
    title: 'Take our pledge to get your campaign plan',
    description:
      'We only work with candidates who are independent of both major parties, and the corrupting influence of big money.',
  },
]

export const firstOnboardingStepId = ONBOARDING_STEPS[0].id

// The three Campaign Story steps, in order. Grouped so the flag-gated injection,
// the follow-on filter, and OnboardingFlow's per-step branching all agree on
// what counts as a story step. `campaign-story-issues` is the final one (its
// Continue persists all three answers).
export const STORY_STEP_IDS = [
  'campaign-story-why',
  'campaign-story-background',
  'campaign-story-issues',
] as const satisfies ReadonlyArray<OnboardingStepConfig['id']>

export const isStoryStepId = (id: OnboardingStepConfig['id']): boolean =>
  (STORY_STEP_IDS as ReadonlyArray<string>).includes(id)
