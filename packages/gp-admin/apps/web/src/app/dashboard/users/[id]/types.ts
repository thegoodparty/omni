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

export interface CustomIssue {
  title: string
  position: string
}

export interface Opponent {
  name: string
  party: string
  description: string
}

export interface GeoLocation {
  lat: number
  lng: number
  geoHash: string
}

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

export interface PathToVictoryData {
  indies: number
  democrats: number
  winNumber: string | number
  republicans: number
  electionType: string
  averageTurnout: number
  electionLocation: string
  projectedTurnout: number
  voterContactGoal: string | number
  totalRegisteredVoters: number
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

export interface CustomVoterFile {
  name: string
  channel: string
  filters: string[]
  purpose: string
  createdAt: string
}

export interface ReportedVoterGoals {
  text: number
  calls: number
  events: number
  digital: number
  robocall: number
  digitalAds: number
  directMail: number
  socialMedia: number
  doorKnocking: number
  phoneBanking: number
}

export interface CampaignPlanStatus {
  status: string
  createdAt: number
}

export interface HubSpotUpdates {
  p2p_sent: string
  date_verified: string
  p2p_campaigns: string
  pro_candidate: string
  verified_candidates: string
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
  aiContent: Record<string, AIContentItem>
  hubspotId: string
  currentStep: string
  lastVisited: number
  campaignPlan: Record<string, string>
  hasVoterFile: string
  lastStepDate: string
  launchStatus: string
  pathToVictory: PathToVictoryData
  hubSpotUpdates: HubSpotUpdates
  customVoterFiles: CustomVoterFile[]
  textCampaignCount: number
  campaignPlanStatus: Record<string, CampaignPlanStatus>
  reportedVoterGoals: ReportedVoterGoals
  path_to_victory_status: string
}

export interface AIContentItem {
  name?: string
  content?: string
  updatedAt?: number | string
  inputValues?: Record<string, string>
  prompt?: string
  status?: string
  createdAt?: number
  existingChat?: Array<{ role: string; content: string }>
}

export interface AIContentGenerationStatus {
  prompt?: string
  status: string
  createdAt: number
  inputValues?: Record<string, string>
  existingChat?: Array<{ role: string; content: string }>
}

export interface PathToVictoryRecord {
  id: number
  createdAt: string
  updatedAt: string
  campaignId: number
  data: PathToVictoryData
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
  aiContent: Record<string, AIContentItem | Record<string, unknown>>
  vendorTsData: Record<string, unknown>
  userId: number
  canDownloadFederal: boolean
  completedTaskIds: string[]
  hasFreeTextsOffer: boolean
  freeTextsOfferRedeemedAt: string | null
  pathToVictory: PathToVictoryRecord
}
