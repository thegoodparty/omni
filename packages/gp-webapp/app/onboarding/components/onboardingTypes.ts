export type OnboardingStepId =
  | 'welcome'
  | 'ballot-status'
  | 'party-affiliation'
  | 'office-selection'
  | 'manual-office-entry'
  | 'path-to-victory'
  | 'campaign-story-why'
  | 'campaign-story-background'
  | 'campaign-story-issues'
  | 'signup-goal'
  | 'pledge'

// Set only by the follow-on flow (running for re-election / a new office from
// the org switcher). The standard first-time onboarding flow never sets these,
// so its visible-step computation is unaffected.
export type FollowOnIntent = 'same-office' | 'new-office'

export type OnboardingOfficePath = 'structured' | 'manual'

/*
    What the office picker had on screen when the candidate gave up on it. None of
    this reaches the campaign record, so the "Manual Office Viewed" event is the
    only place it is ever written down. It is what separates "BallotReady has no
    race here" from "we had the race and our search buried it" (DATA-2525).
*/
export interface OfficePickerGiveUpContext {
  officeZip: string | undefined
  searchQuery: string
  categoryFilter: string
  totalOffices: number
  filteredCount: number
  searchErrored: boolean
}

export type BallotStatus =
  | 'on-ballot'
  | 'qualified-not-filed'
  | 'considering'
  | 'testing'

export type PartyAffiliation =
  | 'nonpartisan'
  | 'independent-or-non-major'
  | 'democrat'
  | 'republican'

export type SignupGoal =
  | 'voter-data'
  | 'voter-outreach'
  | 'campaign-strategy'
  | 'templates-resources'
  | 'exploring'

export interface SelectedOffice {
  raceId: string
  positionId?: string
  positionName: string
  level?: string
  city?: string
  electionDay?: string
  electionId?: string
  state?: string
  partisanType?: string
  hasPrimary?: boolean
  primaryElectionDate?: string
  primaryElectionId?: string
  officeTermLength?: string
  filingPeriodsStart?: string
  filingPeriodsEnd?: string
}

export type OnboardingJsonValue =
  | string
  | number
  | boolean
  | null
  | OnboardingJsonValue[]
  | { [key: string]: OnboardingJsonValue }

export interface ManualOfficeForm {
  office: string
  // A BallotReadyPositionLevel value ('LOCAL' | 'COUNTY' | 'STATE' |
  // 'FEDERAL'), or '' until selected. Persisted to details.ballotLevel, which
  // downstream 10DLC compliance derives the office level from — before this
  // field existed, manual-entry federal candidates were silently treated as
  // local and their FEC filing URL was rejected (ENG-11043).
  level: string
  state: string
  city: string
  district: string
  officeTermLength: string
  electionDate: string
}

export interface OnboardingAnswers {
  officePath?: OnboardingOfficePath
  manualOffice?: boolean
  unmatchedOffice?: boolean
  ballotStatus?: BallotStatus
  partyAffiliation?: PartyAffiliation
  signupGoal?: SignupGoal
  officeZip?: string
  structuredOffice?: SelectedOffice
  manualOfficeForm?: ManualOfficeForm
  // Follow-on flow only — drives the same-office office-picker skip and the
  // POST /v1/campaigns/follow-on payload. Unset in the standard flow.
  followOnIntent?: FollowOnIntent
  fromOrganizationSlug?: string
}

export interface OnboardingStepContext {
  answers: OnboardingAnswers
}

export interface OnboardingStepConfig {
  id: OnboardingStepId
  title: string
  description: string
  whyThisMatters?: string
  shouldSkip?: (context: OnboardingStepContext) => boolean
  isValid?: (context: OnboardingStepContext) => boolean
}

export type NonEmptyArray<T> = readonly [T, ...T[]]
