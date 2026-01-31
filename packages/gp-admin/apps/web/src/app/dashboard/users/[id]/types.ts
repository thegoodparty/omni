/**
 * User detail page types.
 * Imports shared campaign types from @/types/campaign.
 */

export {
  type TopIssuePosition,
  type CustomIssue,
  type Opponent,
  type GeoLocation,
  type PathToVictoryData,
  type CustomVoterFile,
  type VoterGoals as ReportedVoterGoals,
  type HubSpotUpdates,
  type AiContentItem as AIContentItem,
  type AiContentGenerationStatus as AIContentGenerationStatus,
  type PathToVictoryRecord,
  type CampaignPlanStatus,
  type CampaignPlanStatusValue,
  CAMPAIGN_PLAN_STATUS,
} from '@/types/campaign'

import type {
  TopIssuePosition,
  CustomIssue,
  Opponent,
  GeoLocation,
  PathToVictoryData,
  CustomVoterFile,
  VoterGoals,
  HubSpotUpdates,
  AiContentItem,
  CampaignPlanStatus,
  PathToVictoryRecord,
} from '@/types/campaign'

export interface UserDetails {
  dob: string
  zip: string
  city: string
  tier: number
  level: string
  party: string
  phone: string
  state: string
  county: string
  office: string
  raceId: string
  citizen: string
  funFact: string
  knowRun: string
  pledged: boolean
  website: string
  articles: string
  lastName: string
  firstName: string
  runBefore: string
  topIssues: {
    positions: TopIssuePosition[]
    [key: string]: string | TopIssuePosition[]
  }
  electionId: string
  hasPrimary: boolean
  occupation: string
  otherParty: string
  positionId: string
  ballotLevel: string
  geoLocation: GeoLocation
  noCommittee: boolean
  otherOffice: string
  customIssues: CustomIssue[]
  electionDate: string
  partisanType: string
  runForOffice: string
  campaignPhone: string
  filedStatement: string
  pastExperience: string
  runningAgainst: Opponent[]
  campaignWebsite: string
  officeRunBefore: string
  filingPeriodsEnd: string
  officeTermLength: string
  campaignCommittee: string
  filingPeriodsStart: string
  priorElectionDates: string[]
}

export interface UserData {
  id: number
  name: string
  slug: string
  team: { completed: boolean }
  image: string
  launch: Record<string, boolean>
  social: { completed: boolean }
  finance: Record<string, boolean>
  profile: { completed: boolean }
  aiContent: Record<string, AiContentItem>
  hubspotId: string
  currentStep: string
  lastVisited: number
  campaignPlan: Record<string, string>
  hasVoterFile: string
  lastStepDate: string
  launchStatus: string
  pathToVictory?: PathToVictoryData
  hubSpotUpdates: HubSpotUpdates
  customVoterFiles: CustomVoterFile[]
  textCampaignCount: number
  campaignPlanStatus: Record<string, CampaignPlanStatus>
  reportedVoterGoals: VoterGoals
  path_to_victory_status: string
}

export interface DetailedUser {
  id: number
  createdAt: string
  updatedAt: string
  slug: string
  isActive: boolean
  isVerified: boolean
  isPro: boolean
  isDemo: boolean
  didWin: boolean
  dateVerified: string | null
  tier: number | null
  formattedAddress: string | null
  placeId: string | null
  data: UserData
  details: UserDetails
  aiContent: Record<string, AiContentItem | Record<string, unknown>>
  vendorTsData: Record<string, unknown>
  userId: number
  canDownloadFederal: boolean
  completedTaskIds: string[]
  hasFreeTextsOffer: boolean
  freeTextsOfferRedeemedAt: string | null
  pathToVictory: PathToVictoryRecord
}
