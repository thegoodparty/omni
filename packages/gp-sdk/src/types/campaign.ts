import type { PaginationOptions } from './result'

export enum CampaignTier {
  WIN = 'WIN',
  LOSE = 'LOSE',
  TOSSUP = 'TOSSUP',
}

export enum BallotReadyPositionLevel {
  CITY = 'CITY',
  COUNTY = 'COUNTY',
  FEDERAL = 'FEDERAL',
  LOCAL = 'LOCAL',
  REGIONAL = 'REGIONAL',
  STATE = 'STATE',
  TOWNSHIP = 'TOWNSHIP',
}

export enum ElectionLevel {
  state = 'state',
  county = 'county',
  federal = 'federal',
  city = 'city',
}

export enum CampaignCreatedBy {
  ADMIN = 'admin',
}

export enum CampaignLaunchStatus {
  launched = 'launched',
}

export enum OnboardingStep {
  complete = 'onboarding-complete',
  registration = 'registration',
}

export enum GenerationStatus {
  processing = 'processing',
  completed = 'completed',
}

export type VoterGoals = {
  doorKnocking?: number
  calls?: number
  digital?: number
  directMail?: number
  digitalAds?: number
  text?: number
  events?: number
  yardSigns?: number
  robocall?: number
  phoneBanking?: number
  socialMedia?: number
}

export type CustomVoterFile = {
  name: string
  channel?: string
  purpose?: string
  filters: string[]
  createdAt: string
}

export type AiChatMessage = {
  role: 'user' | 'system' | 'assistant'
  content: string
  createdAt?: number
  id?: string
  usage?: number
}

export type AiContentInputValues = Record<
  string,
  string | boolean | number | undefined
>

export type AiContentGenerationStatus = {
  status: GenerationStatus
  createdAt: number
  prompt?: string
  existingChat?: AiChatMessage[]
  inputValues?: AiContentInputValues
}

export type AiContentData = {
  name: string
  content: string
  updatedAt: number
  inputValues?: AiContentInputValues
}

export type CampaignDetails = {
  state?: string
  ballotLevel?: BallotReadyPositionLevel
  electionDate?: string
  primaryElectionDate?: string
  zip?: string | null
  knowRun?: 'yes' | null
  runForOffice?: 'yes' | 'no' | null
  pledged?: boolean
  isProUpdatedAt?: number
  customIssues?: Record<'title' | 'position', string>[]
  runningAgainst?: Record<'name' | 'party' | 'description', string>[]
  geoLocation?: {
    geoHash?: string
    lng?: number
    lat?: number
  }
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
} | null

export type CampaignData = {
  createdBy?: CampaignCreatedBy
  slug?: string
  hubSpotUpdates?: Partial<Record<string, string>>
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
} | null

export type CampaignAiContent = {
  generationStatus?: Record<string, AiContentGenerationStatus>
  campaignPlanAttempts?: Record<string, number>
} & Record<string, AiContentData>

export type Campaign = {
  id: number
  createdAt: string
  updatedAt: string
  slug: string
  isActive: boolean
  isVerified?: boolean | null
  isPro?: boolean | null
  isDemo: boolean
  didWin?: boolean | null
  dateVerified?: string | null
  tier?: CampaignTier | null
  formattedAddress?: string | null
  placeId?: string | null
  data: CampaignData
  details: CampaignDetails
  aiContent: CampaignAiContent
  userId: number
  canDownloadFederal: boolean
  completedTaskIds: string[]
  hasFreeTextsOffer: boolean
  freeTextsOfferRedeemedAt?: string | null
}

export type ListCampaignsOptions = PaginationOptions & {
  userId?: number
  slug?: string
}

export type UpdateCampaignInput = {
  slug?: string
  isActive?: boolean
  isVerified?: boolean | null
  isPro?: boolean | null
  isDemo?: boolean
  didWin?: boolean | null
  dateVerified?: string | null
  tier?: CampaignTier | null
  formattedAddress?: string | null
  placeId?: string | null
  data?: CampaignData
  details?: CampaignDetails
  aiContent?: CampaignAiContent
  canDownloadFederal?: boolean
  completedTaskIds?: string[]
  hasFreeTextsOffer?: boolean
  freeTextsOfferRedeemedAt?: string | null
}
