import {
  RECOMMENDED_LIST_OUTREACH_TYPE_VALUES,
  RecommendedListGoal,
  RecommendedListOutreachType,
  RecommendedListPhase,
} from '@goodparty_org/contracts'

// Every list currently allows every outreach channel; per-list channel curation
// is deferred to Campaign Success. Sourced from the contract value tuple so the
// registry can never drift from the enum.
const ALL_OUTREACH_TYPES: readonly RecommendedListOutreachType[] =
  RECOMMENDED_LIST_OUTREACH_TYPE_VALUES

// The seed of the config-driven recommended-lists model: each list variant's
// static metadata — product goal, display order (priority), the outreach channels
// it may be worked through, the campaign phases it belongs to, its card ordering,
// and its candidate-facing copy — declared in one place. Adding a list is a
// registry entry here + a details schema in contracts + assembly in
// recommendedListsCompute.service.
//
// DATA CHANGE (proposed by Nigel — see the recommended-lists note for Collin).
// This file is the "data" layer; wiring the new tags into the compute service is
// the implementation step (see that note). New/changed vs the merged version:
//   - the contract discriminant is now `variant` (was `kind`); its values are
//     unchanged from Collin's kind — voterSupportId / persuasionPartisanAligned /
//     persuasionIssueAligned / gotv (the last two already renamed from
//     partisanAligned / issueAligned). `goal` is a new, coarser product category
//     several variants can share (both persuasion variants -> 'persuasion').
//   - priority is now a { default, byPhase } object (type ListPriority): GOTV
//     rises to rank 1 in gotvPhase and the anchor steps to 2. The compute service
//     resolves it to the flat `priority` number the contract carries.
//   - priority order corrected: partisan (2) above issue (3), per the deliberate
//     demotion of issue-alignment.
//   - new tags: goal, isActive, geographyOrder, copy (need compute-service wiring).
//   - geographyOrder is a { default, byOutreach } object (type ListGeographyOrder):
//     doors lead densest-first for the anchor + persuasion lists, whole-first for
//     GOTV; every other channel is whole-first (the default).
//   - outreach vocabulary extended to track the product set (socialMedia, poll
//     added; https://snuggle-nav-kit.lovable.app/outreach), keeping `phone` (not
//     phoneBanking) and directMail. Every list allows all channels.
//   - OUTREACH_CONTACTS_PER_HOUR: channel throughput (a property of the channel,
//     not any list). Split out of the old capacity object.
//   - RECOMMENDED_LISTS_CAPACITY: outreach-keyed { minPerCard, maxPerCard } card
//     bounds (door calibrated). "Card" not "turf" — the bound is per surfaced
//     (sub-geography) card, not door-knocking-specific.

// Geographic ordering of a list's sub-geography cards. 'densestFirst' leads with the
// densest sub-geography; 'wholeFirst' leads with the whole-district list.
type GeographyOrder = 'densestFirst' | 'wholeFirst'

// Both of these fall through to `default` for any key not listed, so we never
// enumerate every phase/outreach — only the ones that differ. NOT YET WIRED: the
// compute service currently reads a flat value.
//
// Display order, LOWER = more prominent; `byPhase` overrides `default` per phase.
type ListPriority = {
  default: number
  byPhase?: Partial<Record<RecommendedListPhase, number>>
}
// Sub-geography card ordering; `byOutreach` overrides `default` per channel.
type ListGeographyOrder = {
  default: GeographyOrder
  byOutreach?: Partial<Record<RecommendedListOutreachType, GeographyOrder>>
}

// Candidate-facing card copy for a list: a title and a criteriaSummary — a
// plain-language description of who is on the list — verbatim from the demo (the
// source of truth for copy). Strings may embed {placeholders} that the assembly
// step fills per campaign (e.g. {phrase}, {opponent}, {parties}, {direction},
// {office}); the fill logic stays in code for now.
// NOT YET WIRED — the service still assembles copy from `name` + computed strings.
interface RecommendedListCopy {
  title: string
  criteriaSummary: string
}

interface RecommendedListRegistryEntry {
  name?: string
  // Product-facing outreach goal (candidate-facing categorization). Coarser than
  // the registry key (the machine `variant`): both persuasion variants share
  // 'persuasion'.
  goal: RecommendedListGoal
  copy: RecommendedListCopy
  priority: ListPriority
  // On/off toggle. false => the list is not emitted at all. NOT YET WIRED —
  // the service currently emits every list unconditionally.
  isActive: boolean
  geographyOrder: ListGeographyOrder
  allowedOutreachTypes: readonly RecommendedListOutreachType[]
  allowedPhases: readonly RecommendedListPhase[]
}

// The unique per-list recipe id — the contract's discriminated-union discriminant
// (`variant`). Reuses the values Collin previously had on `kind`; renaming any of
// them (e.g. voterSupportId -> likelyVoters) is a later value-rename.
type RecommendedListVariant =
  | 'voterSupportId'
  | 'persuasionPartisanAligned'
  | 'persuasionIssueAligned'
  | 'gotv'

// Doors (and GOTV over doors) lead whole-first only for GOTV; the anchor and the
// two persuasion lists lead with the densest sub-geography when knocking. Every
// non-door channel is whole-first, so it is the default and only the door
// override is listed.
const DENSEST_DOOR_ELSE_WHOLE: ListGeographyOrder = {
  default: 'wholeFirst',
  byOutreach: { doorKnocking: 'densestFirst' },
}

export const RECOMMENDED_LISTS_REGISTRY = {
  voterSupportId: {
    name: 'Candidate Intro & Voter Support ID',
    goal: 'introduction',
    copy: {
      title: 'Candidate Intro & Voter Support ID list',
      criteriaSummary:
        'Every moderate to high propensity voter in the district who ' +
        'helps you reach the votes needed to win.',
    },
    priority: { default: 1, byPhase: { gotvPhase: 2 } },
    isActive: true,
    geographyOrder: DENSEST_DOOR_ELSE_WHOLE,
    allowedOutreachTypes: ALL_OUTREACH_TYPES,
    allowedPhases: ['earlyCampaign', 'midCampaign', 'gotvPhase'],
  },
  persuasionPartisanAligned: {
    name: 'Voters open to an independent choice',
    goal: 'persuasion',
    copy: {
      title: 'Voters open to an independent choice',
      // {registrationClause} is '' in a nonpartisan race, or
      // 'who are {parties}, and voters ' when opponents are one-party (the
      // opponent-dependent lead-in cardSubtitle() builds).
      criteriaSummary:
        'Moderate-to-high propensity voters {registrationClause}showing ' +
        'signs of independence — party-switchers, ticket-splitters, ' +
        'cross-party primary voters, and those who dislike both major parties.',
    },
    priority: { default: 2 },
    isActive: true,
    geographyOrder: DENSEST_DOOR_ELSE_WHOLE,
    allowedOutreachTypes: ALL_OUTREACH_TYPES,
    allowedPhases: ['midCampaign'],
  },
  persuasionIssueAligned: {
    goal: 'persuasion',
    copy: {
      title: 'Voters who lean {direction} {phrase}',
      criteriaSummary:
        'An opportunity to draw a contrast with {opponent} and widen your ' +
        'support: voters who {position}. Treat this as a hypothesis to test ' +
        'in the field, not a settled bet: it reflects how a voter leans on ' +
        'this issue, not how much they prioritize it.',
    },
    priority: { default: 3 },
    isActive: true,
    geographyOrder: DENSEST_DOOR_ELSE_WHOLE,
    allowedOutreachTypes: ALL_OUTREACH_TYPES,
    allowedPhases: ['midCampaign'],
  },
  gotv: {
    name: 'Get Out The Vote',
    goal: 'gotv',
    copy: {
      title: 'Get out the vote',
      // {dropoffClause} = ', plus likely voters who do not usually vote down
      // to the {office} line' for offices with ballot drop-off, else ''.
      criteriaSummary: 'Sporadic-turnout voters who support you{dropoffClause}.',
    },
    priority: { default: 3, byPhase: { gotvPhase: 1 } },
    isActive: true,
    geographyOrder: { default: 'wholeFirst' },
    allowedOutreachTypes: ALL_OUTREACH_TYPES,
    allowedPhases: ['gotvPhase'],
  },
} as const satisfies Record<RecommendedListVariant, RecommendedListRegistryEntry>

// Channel throughput: contacts reachable per hour on a given outreach channel. A
// property of the channel itself, not of any list. Only doorKnocking is
// calibrated (15 households/hr); the rest are null pending Campaign Success.
export const OUTREACH_CONTACTS_PER_HOUR: Record<
  RecommendedListOutreachType,
  number | null
> = {
  doorKnocking: 15,
  socialMedia: null,
  sms: null,
  email: null,
  robocall: null,
  phone: null,
  poll: null,
  directMail: null,
}

// Outreach-keyed card sizing bounds (campaign- and list-independent). Applied at
// the sizing step (a floor/cap needs a ranking to pick WHICH voters), so declared
// here, not yet enforced. `minPerCard` is the floor — a surfaced (sub-geography)
// card below it is not shown (fall back to district-wide). `maxPerCard` bounds
// each card in a large district without disabling the channel. Only doorKnocking
// is calibrated: 15 households/hr in 3-hour shifts => floor 45 (1 shift), cap
// 4,500 (100 shifts). null = not yet defined (unbounded / no floor) pending
// Campaign Success.
interface OutreachCardBounds {
  minPerCard: number | null
  maxPerCard: number | null
}

export const RECOMMENDED_LISTS_CAPACITY: Record<
  RecommendedListOutreachType,
  OutreachCardBounds
> = {
  doorKnocking: { minPerCard: 45, maxPerCard: 4500 },
  socialMedia: { minPerCard: null, maxPerCard: null },
  sms: { minPerCard: null, maxPerCard: null },
  email: { minPerCard: null, maxPerCard: null },
  robocall: { minPerCard: null, maxPerCard: null },
  phone: { minPerCard: null, maxPerCard: null },
  poll: { minPerCard: null, maxPerCard: null },
  directMail: { minPerCard: null, maxPerCard: null },
}
