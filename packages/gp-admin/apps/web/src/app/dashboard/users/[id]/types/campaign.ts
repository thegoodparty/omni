import type {
  CustomVoterFile,
  VoterGoals,
  HubSpotUpdates,
  AiContentItem,
  CampaignPlanStatus,
  TopIssuePosition,
  CustomIssue,
  Opponent,
  GeoLocation,
} from '@/types/campaign'

export const CAMPAIGN_TIERS = ['WIN', 'LOSE', 'TOSSUP'] as const
export type CampaignTier = (typeof CAMPAIGN_TIERS)[number]

export const CAMPAIGN_LAUNCH_STATUS = [
  'draft',
  'launched',
  'archived',
  'suspended',
] as const
export type CampaignLaunchStatus = (typeof CAMPAIGN_LAUNCH_STATUS)[number]

export const BALLOT_LEVELS = [
  'CITY',
  'COUNTY',
  'FEDERAL',
  'LOCAL',
  'REGIONAL',
  'STATE',
  'TOWNSHIP',
] as const
export type BallotLevel = (typeof BALLOT_LEVELS)[number]

export const ELECTION_LEVELS = [
  'city',
  'county',
  'state',
  'federal',
  'local',
] as const
export type ElectionLevel = (typeof ELECTION_LEVELS)[number]

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
  finance?: Record<string, boolean>
  profile?: { completed: boolean }
  aiContent?: Record<string, AiContentItem>
  campaignPlan?: Record<string, string>
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
  data: CampaignData
  details: CampaignDetails
}

export type {
  CustomVoterFile,
  VoterGoals,
  HubSpotUpdates,
  AiContentItem,
  CampaignPlanStatus,
  TopIssuePosition,
  CustomIssue,
  Opponent,
  GeoLocation,
}
