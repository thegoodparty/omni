import {
  CalendarCheck,
  Flag,
  Megaphone,
  Signpost,
  User,
  Users,
  Wand2,
  type LucideIcon,
} from 'lucide-react'
import {
  CalendarCheckIcon,
  ListChecksIcon,
  MegaphoneIcon,
  UsersRoundIcon,
} from '@styleguide/components/ui/icons'

/**
 * Step set + per-branch ordering for the net-new elected-official ("serve")
 * onboarding. Mirrors the Win flow's `onboardingConfig.ts`, but the serve flow
 * branches on whether the magic link pre-filled the elected office:
 *
 *  - `prefill`  → the user validates the BR-suggested office + term dates on a
 *                 single `confirm` hub (which can detour to `office` /
 *                 `term-dates` and return), so those two collection screens are
 *                 not their own progress steps.
 *  - `net-new`  → the user enters everything fresh: `office` → `term-dates`,
 *                 no `confirm` hub.
 *
 * `welcome`, `inOffice`, and `party` are shared by both branches. The
 * `inOffice` "still campaigning" answer hands the user off to the Win flow and
 * never reaches the steps below.
 */
export type ServeStepId =
  | 'welcome'
  | 'inOffice'
  | 'party'
  | 'office'
  | 'term-dates'
  | 'confirm'
  | ServeStoryStepId
  | 'priorities'
  | 'pledge'

// The district story serve-citizen-panels shows after the term: one
// persistent map that changes mode on each step.
export const SERVE_STORY_STEPS = [
  'story-represent',
  'story-loudest',
  'story-sample',
  'story-grow',
] as const

export type ServeStoryStepId = (typeof SERVE_STORY_STEPS)[number]

export const isServeStoryStep = (step: ServeStepId): step is ServeStoryStepId =>
  (SERVE_STORY_STEPS as readonly string[]).includes(step)

export type ServeBranch = 'prefill' | 'net-new'

/**
 * The user's answer on the `inOffice` step. Only `campaigning` leaves serve.
 * This is UX-only — it selects the onboarding branch (e.g. hands `campaigning`
 * off to the Win flow) and is intentionally never persisted to the elected
 * office record.
 */
export type InOfficeStatus = 'in-office' | 'campaigning' | 'testing'

/**
 * Steps shown in the segmented progress bar for each branch, in order. The
 * `office` and `term-dates` screens are reachable in the `prefill` branch only
 * as detours from `confirm`, so they intentionally do not appear here — the
 * progress bar holds at `confirm` while the user edits.
 */
const PREFILL_STEPS: ServeStepId[] = [
  'welcome',
  'inOffice',
  'party',
  'confirm',
  ...SERVE_STORY_STEPS,
  'priorities',
  'pledge',
]

const NET_NEW_STEPS: ServeStepId[] = [
  'welcome',
  'inOffice',
  'party',
  'office',
  'term-dates',
  ...SERVE_STORY_STEPS,
  'priorities',
  'pledge',
]

// The district story and the `priorities` step are serve-citizen-panels
// only. Without the flag the flow goes from the term straight to `pledge`.
export const getServeBranchSteps = (
  branch: ServeBranch,
  citizenPanels = false,
): ServeStepId[] => {
  const steps = branch === 'prefill' ? PREFILL_STEPS : NET_NEW_STEPS
  if (citizenPanels) return steps
  return steps.filter((s) => !isServeStoryStep(s) && s !== 'priorities')
}

// The first step after the office and term are settled.
export const firstStepAfterTerm = (citizenPanels = false): ServeStepId =>
  citizenPanels ? SERVE_STORY_STEPS[0] : 'pledge'

/**
 * Which of the data-collecting answers are already persisted on the EO/org
 * record when the flow loads. The source of truth for resuming is the saved
 * data itself, not a separate step pointer.
 *
 * `hasParty` is the user's own first answer — `welcome` and `inOffice` collect
 * nothing persisted, and the office / term dates can be pre-filled by sales or
 * BallotReady rather than the user. So `party` is the signal that the user has
 * actually started the flow.
 */
export interface ServeResumeState {
  hasParty: boolean
  hasOffice: boolean
  hasDates: boolean
}

/**
 * Inputs to the branch decision made once at load from the persisted record.
 *
 *  - `officePresent` / `datesPresent` — the EO org carries a position, and/or
 *    the EO record carries (any) term date. Together they mean "office/term
 *    data already exists on this record".
 *  - `selfReported` — the explicit marker set when the user themselves began the
 *    net-new collect path (answering the party step in the net-new branch). It
 *    is the source of truth that disambiguates an office the USER picked from one
 *    a sales/BallotReady prefill provisioned: both end up as a position on the
 *    org, so the populated fields alone cannot tell them apart on resume.
 */
export interface ServeBranchInputs {
  officePresent: boolean
  datesPresent: boolean
  selfReported: boolean
}

/**
 * Decide the onboarding branch from the persisted record.
 *
 * A record is a `prefill` when it arrived with office/term data that the user
 * did NOT enter themselves — i.e. office/dates are present AND the self-reported
 * marker is absent. This is the same condition that arms the BallotReady
 * suggestion-accuracy snapshot, so a partial prefill (office present, no dates,
 * marker absent) is correctly classified `prefill` and its snapshot fires.
 *
 * Once the user self-reports (marker set), the record is deterministically
 * `net-new` even after their own office lands on the org — so they resume in the
 * net-new branch (no misleading "pulled from public records" confirm hub) and
 * no snapshot is emitted for data they supplied.
 */
export const resolveServeBranch = ({
  officePresent,
  datesPresent,
  selfReported,
}: ServeBranchInputs): ServeBranch =>
  (officePresent || datesPresent) && !selfReported ? 'prefill' : 'net-new'

/**
 * Resume target for a returning user so we don't re-ask answered questions.
 *
 *  - Until the user has answered `party`, restart at `welcome` and run the full
 *    intro — a pre-filled office/dates pair is sales/BallotReady context, not
 *    user progress, so it must not skip the introduction.
 *  - Once `party` is answered, resume at the first step after it whose data is
 *    still missing. In the prefill branch the office and term dates are
 *    reviewed/edited on the `confirm` hub, so an incomplete pair resumes there;
 *    in the net-new branch they are their own steps.
 *
 * With every answer saved it resumes at the first step after the term: the
 * pledge itself with serve-citizen-panels off. A completed office is redirected
 * away before the flow renders, so the pledge is always still to take.
 */
export const computeServeResumeStep = (
  branch: ServeBranch,
  { hasParty, hasOffice, hasDates }: ServeResumeState,
  citizenPanels = false,
): ServeStepId => {
  if (!hasParty) return 'welcome'
  if (branch === 'prefill') {
    return hasOffice && hasDates ? firstStepAfterTerm(citizenPanels) : 'confirm'
  }
  if (!hasOffice) return 'office'
  if (!hasDates) return 'term-dates'
  return firstStepAfterTerm(citizenPanels)
}

/**
 * The furthest step the persisted DATA can safely support landing on, used to
 * clamp the step checkpoint. `welcome`, `inOffice`, and `party` collect no
 * gated persisted data (party is entered AT the party step), so the floor is
 * `party` until the user has actually saved an answer; beyond that each step
 * requires its predecessor's data to have been persisted. This is the guardrail
 * that stops a checkpoint written after a best-effort save that later failed
 * from skipping a step whose answer never reached the database.
 */
const maxDataSufficientStep = (
  branch: ServeBranch,
  { hasParty, hasOffice, hasDates }: ServeResumeState,
): ServeStepId => {
  if (!hasParty) return 'party'
  if (branch === 'prefill') return hasOffice && hasDates ? 'pledge' : 'confirm'
  if (!hasOffice) return 'office'
  if (!hasDates) return 'term-dates'
  return 'pledge'
}

/**
 * Resume target that honors the persisted step checkpoint (written on every
 * "Continue") so a returning user lands on the EXACT most recent step — even
 * steps with no data field (`inOffice`, the district story) that the data-derived
 * `computeServeResumeStep` cannot pinpoint.
 *
 *  - No checkpoint (legacy rows / sales prefills provisioned before this
 *    existed) → fall back to the data-derived step, preserving prior behavior.
 *  - A checkpoint that isn't a real step for the resolved branch is ignored
 *    (defensive against a branch flip between sessions).
 *  - The checkpoint is clamped to `maxDataSufficientStep` so it can never route
 *    PAST a step whose required answer was never persisted (a save that
 *    degraded gracefully), in which case we resume at that missing-data step.
 */
export const resolveServeResumeStep = (
  branch: ServeBranch,
  checkpoint: ServeStepId | null | undefined,
  dataState: ServeResumeState,
  citizenPanels = false,
): ServeStepId => {
  if (!checkpoint) {
    return computeServeResumeStep(branch, dataState, citizenPanels)
  }
  const steps = getServeBranchSteps(branch, citizenPanels)
  if (!steps.includes(checkpoint)) {
    return computeServeResumeStep(branch, dataState, citizenPanels)
  }
  const furthestSafe = maxDataSufficientStep(branch, dataState)
  return steps.indexOf(checkpoint) > steps.indexOf(furthestSafe)
    ? furthestSafe
    : checkpoint
}

/**
 * Prompt-first gating for the prefill `confirm` hub. The confirm screen is only
 * ever shown once the office AND valid term dates are present, so whenever the
 * flow wants to land the user on `confirm` (resume, the prefill party Continue,
 * or returning from a detour) we first route them to fill any missing/invalid
 * piece — office, then term dates — instead of surfacing a red error on the hub.
 *
 *  - `officeReady` — a real office is resolvable (a fresh pick or a prefilled
 *    position name), not the default placeholder label.
 *  - `datesReady` — both bounds are present, the end is after the start, and the
 *    term does not overlap an existing one (the flow's term-date invariants).
 *
 * The caller arms the return-to-confirm detour flag when this returns a
 * collection step, so the step's Continue brings the user back to re-evaluate.
 */
export interface ServeConfirmReadiness {
  officeReady: boolean
  datesReady: boolean
}

export const resolveConfirmEntryStep = ({
  officeReady,
  datesReady,
}: ServeConfirmReadiness): ServeStepId => {
  if (!officeReady) return 'office'
  if (!datesReady) return 'term-dates'
  return 'confirm'
}

/**
 * Whether the resolved resume step is past the intro screens (`welcome` /
 * `inOffice`), in which case the UX-only `inOffice` answer should be seeded so
 * backing up to the inOffice step isn't a dead end (its Continue gate needs a
 * selection). Resuming AT `welcome`/`inOffice` leaves it for the user to pick.
 */
export const shouldSeedInOfficeOnResume = (step: ServeStepId): boolean =>
  step !== 'welcome' && step !== 'inOffice'

/**
 * Resolve the active step's 1-based position and the branch's total count for
 * the "Step X of N" label + segmented bar. Detour steps (`office`/`term-dates`
 * in the prefill branch) map back onto `confirm` so the bar doesn't jump.
 */
export const getServeProgress = (
  branch: ServeBranch,
  step: ServeStepId,
  citizenPanels = false,
): { current: number; total: number } => {
  const steps = getServeBranchSteps(branch, citizenPanels)
  const total = steps.length
  let index = steps.indexOf(step)
  if (index === -1) {
    // A detour screen (prefill branch's office/term-dates). Anchor on confirm.
    index = steps.indexOf('confirm')
  }
  return { current: Math.max(index, 0) + 1, total }
}

export interface ServeStepCopy {
  title: string
  description: string
  whyWeAsk?: string
}

export const SERVE_STEP_COPY: Record<
  Exclude<ServeStepId, ServeStoryStepId>,
  ServeStepCopy
> = {
  welcome: {
    title: 'Meet your virtual chief of staff in 5 minutes',
    description:
      "All we need to know is what office you hold and where, and we'll take it from there.",
  },
  inOffice: {
    title: 'Are you already in office?',
    description:
      "We'll tailor your experience based on where you are in your journey.",
    whyWeAsk:
      'Your status determines your timeline. We use this to tailor whether you see transition resources or governing tools.',
  },
  party: {
    title: "What's your party designation?",
    description:
      'This is the party designation that you were elected under, not your personal voting history or party preference.',
    whyWeAsk:
      'Your party designation determines how we approach solving the issues that are most important to your community.',
  },
  office: {
    title: 'What office do you currently hold?',
    description:
      "We'll use this to analyze local constituent data, trends, & news.",
    whyWeAsk:
      'Your office and location let us pull the right constituent data, legislation, meetings, and budgets to help you drive change.',
  },
  'term-dates': {
    title: 'When does your term run?',
    description:
      'Tell us when your current term starts and ends so we can keep your briefings and timeline accurate.',
    whyWeAsk:
      'Your term dates let us schedule the right briefings at the right time, and make sure your offices never overlap.',
  },
  confirm: {
    title: 'Does this look right?',
    description:
      'We pulled this from public records. Confirm your office and term dates, or change anything that looks off.',
    whyWeAsk:
      'These details ensure we pull the right information and data to help you serve your community',
  },
  priorities: {
    title: 'Turn what you ran on into what you work on',
    description:
      'Your priorities, shaped by what residents tell you. Your Chief of Staff keeps each one moving.',
    whyWeAsk:
      'Your priorities shape your briefings and the questions we suggest asking your constituents.',
  },
  pledge: {
    title: 'Take our pledge to get your chief of staff',
    description:
      'We only work with officials who are independent of both major parties, and the corrupting influence of big money.',
  },
}

// With serve-citizen-panels on, the welcome and pledge reframe onboarding
// around hearing from the community instead of the chief of staff.
export const SERVE_CITIZEN_PANELS_STEP_COPY: Pick<
  Record<ServeStepId, ServeStepCopy>,
  'welcome' | 'pledge'
> = {
  welcome: {
    title: 'Hear from your whole community, not only the loudest voices',
    description:
      "Tell us what office you hold and where. We'll help you listen, act, and report back.",
  },
  pledge: {
    title: 'Take our pledge to get started',
    description: SERVE_STEP_COPY.pledge.description,
  },
}

export const SERVE_CITIZEN_PANELS_PLEDGE_BUTTON = 'Meet your Chief of Staff'

// The district story's copy. Titles are split so the accent words can be
// colored without a second string to keep in sync.
export interface ServeStoryTitle {
  lead: string
  accent: string
  tail: string
}

export const SERVE_STORY_COPY = {
  represent: {
    title: (people: string): ServeStoryTitle => ({
      lead: 'You represent',
      accent: people,
      tail: 'people',
    }),
    titleWithoutCount: 'You represent every resident of your district',
    description: (perDot: string, place: string): string =>
      `Every dot is about ${perDot} residents of ${place}. Each of them counts on you to speak for them.`,
    descriptionWithoutCount: (place: string): string =>
      `Every dot is a group of residents of ${place}. Each of them counts on you to speak for them.`,
    defaultPlace: 'your district',
  },
  loudest: {
    title: {
      lead: "Until now, you've heard from the",
      accent: 'loudest voices',
      tail: 'only',
    } satisfies ServeStoryTitle,
    description:
      'The people who make it to a meeting or send an email. Most residents never do.',
    heardFrom: 'Heard from',
    notHeardFrom: 'Not heard from yet',
  },
  sample: {
    title: (answers: number): ServeStoryTitle => ({
      lead: 'With about',
      accent: `${answers} answers`,
      tail: ", you'll know where your community stands",
    }),
    description:
      'Picked at random from every corner of your district, they tell you a lot about what everyone thinks.',
    howWeGotIt: 'How we got this number',
    explanation: (answers: number): string =>
      `We picked ${answers} so that every group making up 3% or more of your district is expected to answer at least 3 times.`,
  },
  grow: {
    title: "We'll help you build and grow the list of people you hear from",
    description:
      'Listen to the people first. Then prioritize, act, and tell them what you did.',
    loop: [
      { title: 'Listen', desc: 'Text, call or knock' },
      { title: 'Prioritize', desc: 'See what matters most' },
      { title: 'Act', desc: 'Bring it to your vote' },
      { title: 'Communicate', desc: 'Tell them what you did' },
    ],
    again: 'Then listen again. Each round, your panel grows.',
  },
}

export interface ServeValueProp {
  icon: LucideIcon
  title: string
  desc: string
}

export const SERVE_WELCOME_VALUE_PROPS: ServeValueProp[] = [
  {
    icon: Signpost,
    title: 'Get a clear roadmap to drive the change you were elected for',
    desc: 'We use real constituent data, legislation, and budgets to help solve the most important issues facing your constituents.',
  },
  {
    icon: Megaphone,
    title: 'Monitor local community signals on what issues matter most',
    desc: 'We analyze your local constituent data, news, and social media to surface and rank their top issues and concerns.',
  },
  {
    icon: CalendarCheck,
    title: 'Be the most prepared person in the room with meeting briefings',
    desc: 'We provide personalized, actionable meeting briefings that help you cut through the noise and represent your community.',
  },
  {
    icon: Wand2,
    title: 'Draft legislation and get feedback directly from your community',
    desc: 'We help you draft legislation based on what works in communities like yours. Share with your constituents and get early feedback.',
  },
]

export const SERVE_CITIZEN_PANELS_WELCOME_VALUE_PROPS: ServeValueProp[] = [
  {
    icon: UsersRoundIcon,
    title: 'Ask residents before you vote',
    desc: "We'll help you build and grow the list of people you hear from, picked from every corner of your district.",
  },
  {
    icon: MegaphoneIcon,
    title: 'Know what your community is talking about',
    desc: 'We track local news, meetings, and constituent data to surface the issues residents raise most.',
  },
  {
    icon: ListChecksIcon,
    title: 'Follow through on the issues you were elected to solve',
    desc: 'Get a plan for each priority, draft ordinances that work, and report back on what you did.',
  },
  {
    icon: CalendarCheckIcon,
    title: 'Walk into every meeting prepared',
    desc: "Get a briefing before each meeting on what's on the agenda and what to ask.",
  },
]

export interface ServeOption<T extends string> {
  value: T
  title: string
  desc: string
}

export const SERVE_IN_OFFICE_OPTIONS: ServeOption<InOfficeStatus>[] = [
  {
    value: 'in-office',
    title: "I'm an elected official",
    desc: 'I currently hold an elected position, or am about to be sworn in.',
  },
  {
    value: 'campaigning',
    title: "I'm still campaigning",
    desc: 'Running in an upcoming or active election.',
  },
  {
    value: 'testing',
    title: "I'm just testing out the product",
    desc: 'Exploring the platform before committing.',
  },
]

export const SERVE_PARTY_OPTIONS: ServeOption<string>[] = [
  {
    value: 'independent',
    title: 'Independent / Non-major party',
    desc: 'Serving independent of both major parties.',
  },
  {
    value: 'nonpartisan',
    title: 'Nonpartisan',
    desc: 'The office itself is officially nonpartisan (most local seats).',
  },
  {
    value: 'democratic',
    title: 'Democrat',
    desc: 'Serving as a Democrat.',
  },
  {
    value: 'republican',
    title: 'Republican',
    desc: 'Serving as a Republican.',
  },
]

/**
 * The major-party `party` values that disqualify a user, mirroring the Win
 * flow's partisan-party handling: selecting one blocks Continue and surfaces the
 * shared partisan-block alert. These are the persisted ElectedOffice `party`
 * values (`democratic`/`republican`), so the EO record contract stays intact.
 */
export const SERVE_MAJOR_PARTY_VALUES = ['democratic', 'republican'] as const

export const isServeMajorParty = (value: string | null): boolean =>
  value !== null &&
  (SERVE_MAJOR_PARTY_VALUES as readonly string[]).includes(value)

export interface ServePledgeCommitment {
  icon: LucideIcon
  title: string
  detail: string
}

export const SERVE_PLEDGE_COMMITMENTS: ServePledgeCommitment[] = [
  {
    icon: User,
    title: 'Independent',
    detail:
      'I will run and serve as a non-partisan, independent or third party candidate, not as a Democrat or Republican. I will not accept endorsements from either the Republican or Democratic party.',
  },
  {
    icon: Users,
    title: 'People-First',
    detail:
      'I get a majority of my funding from individuals, not from political action committees (PACs), lobbies, unions or corporations. I do not accept funding from either the Republican or Democratic party. Once elected, I will focus on solving the problems facing my constituents, not serving myself or special interests.',
  },
  {
    icon: Flag,
    title: 'Anti-Corruption',
    detail:
      'I will always uphold the highest level of integrity by being open, transparent and accountable about my donors, positions and progress. I only serve the people, so I will use the best tools and data available to stay connected and responsive to my constituents.',
  },
]
