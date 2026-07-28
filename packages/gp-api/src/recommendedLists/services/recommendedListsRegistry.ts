import {
  RecommendedListOutreachType,
  RecommendedListPhase,
} from '@goodparty_org/contracts'

// The seed of the config-driven recommended-lists model: each list kind's
// static metadata — display order (priority), the outreach channels it may be
// worked through, and the campaign phases it belongs to — declared in one
// place. Adding a list is a registry entry here + a details schema in contracts
// + assembly in recommendedListsCompute.service. persuasionIssueAligned carries
// no name because its name is computed per card (direction-aware) at assembly time.
//
// DATA CHANGE (proposed by Nigel — see the recommended-lists note for Collin).
// This file is the "data" layer; wiring the new tags into the compute service is
// the implementation step (see that note). New/changed vs the merged version:
//   - kinds renamed: partisanAligned -> persuasionPartisanAligned,
//     issueAligned -> persuasionIssueAligned (contract union renamed to match).
//   - priority is now a { default, byPhase } object (phase-keyed): GOTV rises to
//     rank 1 in gotvPhase and the anchor steps to 2. The compute service resolves
//     it to the flat `priority` number the contract still carries.
//   - priority order corrected: partisan (2) above issue (3), per the deliberate
//     demotion of issue-alignment.
//   - voterSupportId widened to all outreach channels and allowed in gotvPhase.
//   - new tags: isActive, geographyOrder (need compute-service wiring).
//   - RECOMMENDED_LISTS_CAPACITY: outreach-keyed capacity policy (applied at sizing).

// Geographic ordering of a list's turf cards. 'densestFirst' leads with the
// densest sub-geography; 'wholeFirst' leads with the whole-district list (GOTV).
type GeographyOrder = 'densestFirst' | 'wholeFirst'

// Display order, LOWER = more prominent (rank 1 = top card). `byPhase` overrides
// `default` for a given campaign phase. The compute service resolves the emitted
// (flat) priority as `byPhase[phase] ?? default` for the requested phase.
// NOT YET WIRED — the service currently emits a flat number.
interface RecommendedListPriority {
  default: number
  byPhase?: Partial<Record<RecommendedListPhase, number>>
}

interface RecommendedListRegistryEntry {
  name?: string
  priority: RecommendedListPriority
  // On/off toggle. false => the list is not emitted at all. NOT YET WIRED —
  // the service currently emits every list unconditionally.
  isActive: boolean
  // Turf-card ordering. NOT YET WIRED — turf order is currently implicit in the
  // query. GOTV wants wholeFirst; the rest densestFirst.
  geographyOrder: GeographyOrder
  allowedOutreachTypes: readonly RecommendedListOutreachType[]
  allowedPhases: readonly RecommendedListPhase[]
}

type RecommendedListKind =
  | 'voterSupportId'
  | 'persuasionPartisanAligned'
  | 'persuasionIssueAligned'
  | 'gotv'

export const RECOMMENDED_LISTS_REGISTRY = {
  voterSupportId: {
    name: 'Candidate Intro & Voter Support ID',
    priority: { default: 1, byPhase: { gotvPhase: 2 } },
    isActive: true,
    geographyOrder: 'densestFirst',
    allowedOutreachTypes: [
      'doorKnocking',
      'phone',
      'sms',
      'email',
      'directMail',
      'robocall',
    ],
    allowedPhases: ['earlyCampaign', 'midCampaign', 'gotvPhase'],
  },
  persuasionPartisanAligned: {
    name: 'Voters open to an independent choice',
    priority: { default: 2 },
    isActive: true,
    geographyOrder: 'densestFirst',
    allowedOutreachTypes: ['doorKnocking', 'phone', 'email', 'directMail'],
    allowedPhases: ['midCampaign'],
  },
  persuasionIssueAligned: {
    priority: { default: 3 },
    isActive: true,
    geographyOrder: 'densestFirst',
    allowedOutreachTypes: ['doorKnocking', 'phone', 'email', 'directMail'],
    allowedPhases: ['midCampaign'],
  },
  gotv: {
    name: 'Get Out The Vote',
    priority: { default: 3, byPhase: { gotvPhase: 1 } },
    isActive: true,
    geographyOrder: 'wholeFirst',
    allowedOutreachTypes: ['doorKnocking', 'phone', 'robocall', 'email'],
    allowedPhases: ['gotvPhase'],
  },
} as const satisfies Record<RecommendedListKind, RecommendedListRegistryEntry>

// Outreach-keyed capacity policy (campaign-independent). Applied at the sizing
// step (a floor/cap needs a ranking to pick WHICH voters), so declared here, not
// yet enforced. Only doorKnocking is calibrated: 15 households/hr in 3-hour
// shifts, so floor = 1 shift (45) and cap = 100 shifts (4,500). null = not yet
// defined (unbounded / no floor) pending Campaign Success input.
interface OutreachCapacity {
  contactsPerHour: number | null
  minCard: number | null // card floor; no sub-geo below it is surfaced
  maxPerTurf: number | null // per-turf cap; a large district is bounded, not disabled
}

export const RECOMMENDED_LISTS_CAPACITY: Record<
  RecommendedListOutreachType,
  OutreachCapacity
> = {
  doorKnocking: { contactsPerHour: 15, minCard: 45, maxPerTurf: 4500 },
  phone: { contactsPerHour: null, minCard: null, maxPerTurf: null },
  sms: { contactsPerHour: null, minCard: null, maxPerTurf: null },
  email: { contactsPerHour: null, minCard: null, maxPerTurf: null },
  directMail: { contactsPerHour: null, minCard: null, maxPerTurf: null },
  robocall: { contactsPerHour: null, minCard: null, maxPerTurf: null },
}
