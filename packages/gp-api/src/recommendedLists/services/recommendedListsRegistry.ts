import {
  RecommendedListOutreachType,
  RecommendedListPhase,
} from '@goodparty_org/contracts'

// The seed of the config-driven recommended-lists model: each list kind's
// static metadata — display order (priority), the outreach channels it may be
// worked through, and the campaign phases it belongs to — declared in one
// place. Adding a list is a registry entry here + a details schema in contracts
// + assembly in recommendedListsCompute.service. issueAligned carries no name
// because its name is computed per card (direction-aware) at assembly time.

interface RecommendedListRegistryEntry {
  name?: string
  priority: number
  allowedOutreachTypes: readonly RecommendedListOutreachType[]
  allowedPhases: readonly RecommendedListPhase[]
}

type RecommendedListKind =
  | 'voterSupportId'
  | 'issueAligned'
  | 'partisanAligned'
  | 'gotv'

export const RECOMMENDED_LISTS_REGISTRY = {
  voterSupportId: {
    name: 'Candidate Intro & Voter Support ID',
    priority: 1,
    allowedOutreachTypes: ['doorKnocking'],
    allowedPhases: ['earlyCampaign', 'midCampaign'],
  },
  issueAligned: {
    priority: 2,
    allowedOutreachTypes: ['doorKnocking', 'phone', 'email', 'directMail'],
    allowedPhases: ['midCampaign'],
  },
  partisanAligned: {
    name: 'Partisanship-Aligned Voters',
    priority: 3,
    allowedOutreachTypes: ['doorKnocking', 'phone', 'email', 'directMail'],
    allowedPhases: ['midCampaign'],
  },
  gotv: {
    name: 'Get Out The Vote',
    priority: 4,
    allowedOutreachTypes: ['doorKnocking', 'phone', 'robocall', 'email'],
    allowedPhases: ['gotvPhase'],
  },
} as const satisfies Record<RecommendedListKind, RecommendedListRegistryEntry>
