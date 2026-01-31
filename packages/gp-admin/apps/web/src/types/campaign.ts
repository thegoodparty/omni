/**
 * Campaign types - duplicated from backend for now.
 * TODO: Move to shared packages/types package.
 */

export type BallotReadyPositionLevel =
  | 'CITY'
  | 'COUNTY'
  | 'STATE'
  | 'FEDERAL'
  | 'LOCAL'

export type ElectionLevel = 'city' | 'county' | 'state' | 'federal' | 'local'

export type CampaignCreatedBy = 'user' | 'admin' | 'import'

export type CampaignLaunchStatus =
  | 'draft'
  | 'launched'
  | 'archived'
  | 'suspended'

export type OnboardingStep =
  | 'profile'
  | 'team'
  | 'social'
  | 'finance'
  | 'launch'
  | 'complete'

export interface VoterGoals {
  text?: number
  calls?: number
  events?: number
  digital?: number
  robocall?: number
  digitalAds?: number
  directMail?: number
  socialMedia?: number
  doorKnocking?: number
  phoneBanking?: number
}

export interface CustomVoterFile {
  name: string
  channel: string
  filters: string[]
  purpose: string
  createdAt: string
}

export interface GeoLocation {
  geoHash?: string
  lng?: number
  lat?: number
}

export interface CustomIssue {
  title: string
  position: string
}

export interface Opponent {
  name: string
  party: string
  description: string
}

export interface CampaignDetails {
  state?: string
  ballotLevel?: BallotReadyPositionLevel
  electionDate?: string
  primaryElectionDate?: string
  zip?: string
  knowRun?: 'yes' | null
  runForOffice?: 'yes' | 'no' | null
  pledged?: boolean
  isProUpdatedAt?: number
  customIssues?: CustomIssue[]
  runningAgainst?: Opponent[]
  geoLocation?: GeoLocation
  geoLocationFailed?: boolean
  city?: string | null
  county?: string | null
  normalizedOffice?: string | null
  otherOffice?: string
  office?: string
  party?: string
  otherParty?: string
  district?: string
  raceId?: string
  level?: ElectionLevel | null
  noNormalizedOffice?: boolean
  website?: string
  pastExperience?: string | Record<string, string>
  occupation?: string
  funFact?: string
  campaignCommittee?: string
  statementName?: string
  subscriptionId?: string | null
  endOfElectionSubscriptionCanceled?: boolean
  subscriptionCanceledAt?: number | null
  subscriptionCancelAt?: number | null
  filingPeriodsStart?: string | null
  filingPeriodsEnd?: string | null
  officeTermLength?: string
  partisanType?: string
  priorElectionDates?: string[]
  positionId?: string | null
  electionId?: string | null
  tier?: string
  einNumber?: string | null
  wonGeneral?: boolean
  // Additional fields from frontend usage
  dob?: string
  phone?: string
  firstName?: string
  lastName?: string
  citizen?: string
  runBefore?: string
  filedStatement?: string
  campaignPhone?: string
  campaignWebsite?: string
  officeRunBefore?: string
  articles?: string
  hasPrimary?: boolean
  noCommittee?: boolean
  topIssues?: {
    positions: TopIssuePosition[]
    [key: string]: string | TopIssuePosition[]
  }
}

export interface TopIssuePosition {
  id: number
  name: string
  topIssue: {
    id: number
    name: string
    createdAt: number
    updatedAt: number
  }
  createdAt: number
  updatedAt: number
}

export interface HubSpotUpdates {
  p2p_sent?: string
  date_verified?: string
  p2p_campaigns?: string
  pro_candidate?: string
  verified_candidates?: string
  [key: string]: string | undefined
}

export interface CampaignData {
  createdBy?: CampaignCreatedBy
  slug?: string
  hubSpotUpdates?: HubSpotUpdates
  currentStep?: OnboardingStep
  launchStatus?: CampaignLaunchStatus
  lastVisited?: number
  claimProfile?: string
  customVoterFiles?: CustomVoterFile[]
  reportedVoterGoals?: VoterGoals
  textCampaignCount?: number
  lastStepDate?: string
  adminUserEmail?: string
  hubspotId?: string
  name?: string
  // Additional fields from frontend usage
  id?: number
  team?: { completed: boolean }
  image?: string
  launch?: Record<string, boolean>
  social?: { completed: boolean }
  finance?: Record<string, boolean>
  profile?: { completed: boolean }
  aiContent?: Record<string, AiContentItem>
  campaignPlan?: Record<string, string>
  hasVoterFile?: string
  pathToVictory?: PathToVictoryData
  campaignPlanStatus?: Record<string, CampaignPlanStatus>
  path_to_victory_status?: string
}

export interface AiContentItem {
  name?: string
  content?: string
  updatedAt?: number | string
  inputValues?: Record<string, string>
  prompt?: string
  status?: string
  createdAt?: number
  existingChat?: Array<{ role: string; content: string }>
}

export interface AiContentGenerationStatus {
  prompt?: string
  status: string
  createdAt: number
  inputValues?: Record<string, string>
  existingChat?: Array<{ role: string; content: string }>
}

export const CAMPAIGN_PLAN_STATUS = {
  COMPLETED: 'completed',
  FAILED: 'failed',
  PENDING: 'pending',
} as const

export type CampaignPlanStatusValue =
  (typeof CAMPAIGN_PLAN_STATUS)[keyof typeof CAMPAIGN_PLAN_STATUS]

export interface CampaignPlanStatus {
  status: CampaignPlanStatusValue | string
  createdAt: number
}

export interface PathToVictoryData {
  indies?: number
  democrats?: number
  winNumber?: string | number
  republicans?: number
  electionType?: string
  averageTurnout?: number
  electionLocation?: string
  projectedTurnout?: number
  voterContactGoal?: string | number
  totalRegisteredVoters?: number
  men?: number
  women?: number
  asian?: number
  white?: number
  hispanic?: number
  africanAmerican?: number
  source?: string
  p2vStatus?: string
  districtId?: string
  p2vAttempts?: number
  p2vComplete?: string
  p2vCompleteDate?: string
  districtManuallySet?: boolean
  viability?: {
    level: string
    score: number
    seats: number
    candidates: string
    isPartisan: boolean
    isIncumbent: string
    isUncontested: string
    candidatesPerSeat: string
  }
}

export interface PathToVictoryRecord {
  id: number
  createdAt: string
  updatedAt: string
  campaignId: number
  data: PathToVictoryData
}
