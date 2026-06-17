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
  | 'constituents'
  | 'pledge'

export type ServeBranch = 'prefill' | 'net-new'

/** The user's answer on the `inOffice` step. Only `campaigning` leaves serve. */
export type InOfficeStatus =
  | 'in-office'
  | 'won-not-sworn'
  | 'campaigning'
  | 'testing'

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
  'constituents',
  'pledge',
]

const NET_NEW_STEPS: ServeStepId[] = [
  'welcome',
  'inOffice',
  'party',
  'office',
  'term-dates',
  'constituents',
  'pledge',
]

export const getServeBranchSteps = (branch: ServeBranch): ServeStepId[] =>
  branch === 'prefill' ? PREFILL_STEPS : NET_NEW_STEPS

/**
 * Resolve the active step's 1-based position and the branch's total count for
 * the "Step X of N" label + segmented bar. Detour steps (`office`/`term-dates`
 * in the prefill branch) map back onto `confirm` so the bar doesn't jump.
 */
export const getServeProgress = (
  branch: ServeBranch,
  step: ServeStepId,
): { current: number; total: number } => {
  const steps = getServeBranchSteps(branch)
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

export const SERVE_STEP_COPY: Record<ServeStepId, ServeStepCopy> = {
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
  },
  constituents: {
    title: "Here's everything to know about your constituents",
    description:
      'We crunch constituent data and local news to prioritize the most important issues for your office.',
    whyWeAsk:
      "Understanding your constituents' makeup and concerns helps you prioritize where to focus and how to communicate.",
  },
  pledge: {
    title: 'Take our pledge to get your chief of staff',
    description:
      'We only work with officials who are independent of both major parties, and the corrupting influence of big money.',
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
      'I get a majority of my funding from individuals, not from political action committees (PACs), lobbies, unions or corporations. Once elected, I will focus on solving the problems facing my constituents, not serving myself or special interests.',
  },
  {
    icon: Flag,
    title: 'Anti-Corruption',
    detail:
      'I will always uphold the highest level of integrity by being open, transparent and accountable about my donors, positions and progress. I only serve the people, so I will use the best tools and data available to stay connected and responsive to my constituents.',
  },
]
