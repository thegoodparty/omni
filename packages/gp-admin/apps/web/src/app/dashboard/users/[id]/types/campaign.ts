// Import shared types and constants from global types
import type {
  CustomVoterFile,
  VoterGoals,
  HubSpotUpdates,
  AiContentItem,
  CampaignPlanStatus,
  CampaignFinance,
  CampaignPlan,
  TopIssuePosition,
  CustomIssue,
  Opponent,
  GeoLocation,
  BallotReadyPositionLevel,
  ElectionLevel,
  CampaignLaunchStatus,
  CampaignTier,
} from '@/types/campaign'

// Re-export const arrays from global types
export {
  BALLOT_LEVELS,
  ELECTION_LEVELS,
  CAMPAIGN_TIERS,
  CAMPAIGN_LAUNCH_STATUS,
} from '@/types/campaign'

// Re-export type aliases for local usage
export type BallotLevel = BallotReadyPositionLevel
export type { ElectionLevel, CampaignLaunchStatus, CampaignTier }

// UI-focused interfaces (subset of fields needed for display)
export interface CampaignData {
  id?: number
  name?: string
  slug?: string
  image?: string
  hubspotId?: string
  currentStep?: string
  lastVisited?: number
  lastStepDate?: string
  launchStatus?: CampaignLaunchStatus
  hasVoterFile?: string
  textCampaignCount?: number
  adminUserEmail?: string
  team?: { completed: boolean }
  launch?: Record<string, boolean>
  social?: { completed: boolean }
  finance?: CampaignFinance
  profile?: { completed: boolean }
  campaignPlan?: CampaignPlan
  hubSpotUpdates?: HubSpotUpdates
  customVoterFiles?: CustomVoterFile[]
  campaignPlanStatus?: Record<string, CampaignPlanStatus>
  reportedVoterGoals?: VoterGoals
  path_to_victory_status?: string
}

export interface CampaignDetails {
  dob?: string
  zip?: string
  city?: string
  tier?: number
  level?: ElectionLevel | null
  party?: string
  phone?: string
  state?: string
  county?: string
  office?: string
  raceId?: string
  citizen?: string
  funFact?: string
  knowRun?: string
  pledged?: boolean
  website?: string
  articles?: string
  lastName?: string
  firstName?: string
  runBefore?: string
  topIssues?: {
    positions: TopIssuePosition[]
    [key: string]: string | TopIssuePosition[]
  }
  electionId?: string
  hasPrimary?: boolean
  occupation?: string
  otherParty?: string
  positionId?: string
  ballotLevel?: BallotLevel
  geoLocation?: GeoLocation
  noCommittee?: boolean
  otherOffice?: string
  customIssues?: CustomIssue[]
  electionDate?: string
  partisanType?: string
  runForOffice?: string
  campaignPhone?: string
  filedStatement?: string
  pastExperience?: string
  runningAgainst?: Opponent[]
  campaignWebsite?: string
  officeRunBefore?: string
  filingPeriodsEnd?: string | null
  officeTermLength?: string
  campaignCommittee?: string
  filingPeriodsStart?: string | null
  priorElectionDates?: string[]
  primaryElectionDate?: string
  district?: string
}

export interface Campaign {
  id: number
  createdAt: string
  updatedAt: string
  slug: string
  userId: number
  isActive: boolean
  isVerified: boolean | null
  isPro: boolean | null
  isDemo: boolean
  didWin: boolean | null
  dateVerified: string | null
  tier: CampaignTier | null
  canDownloadFederal: boolean
  aiContent?: Record<string, AiContentItem>
  data: CampaignData
  details: CampaignDetails
}

// Re-export utility types for consumers
export type {
  CustomVoterFile,
  VoterGoals,
  HubSpotUpdates,
  AiContentItem,
  CampaignPlanStatus,
  CampaignFinance,
  CampaignPlan,
  TopIssuePosition,
  CustomIssue,
  Opponent,
  GeoLocation,
}
