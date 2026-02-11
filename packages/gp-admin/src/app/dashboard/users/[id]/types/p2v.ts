export const P2V_STATUS = [
  'Waiting',
  'Processing',
  'Complete',
  'Failed',
  'Not Needed',
] as const
export type P2VStatus = (typeof P2V_STATUS)[number]

export interface Viability {
  level?: string
  score?: number
  seats?: number
  candidates?: number | string
  isPartisan?: boolean
  isIncumbent?: boolean | string
  isUncontested?: boolean | string
  candidatesPerSeat?: number | string
}

export interface PathToVictoryData {
  // Status
  p2vStatus?: P2VStatus
  source?: string
  p2vComplete?: string
  p2vCompleteDate?: string
  p2vAttempts?: number

  // Election info
  electionType?: string
  electionLocation?: string
  districtId?: string
  districtManuallySet?: boolean

  // Target Numbers
  winNumber?: string | number
  voterContactGoal?: string | number
  totalRegisteredVoters?: number
  projectedTurnout?: number
  averageTurnout?: number

  // Demographics - Party
  republicans?: number
  democrats?: number
  indies?: number

  // Demographics - Gender
  men?: number
  women?: number

  // Demographics - Race/Ethnicity
  white?: number
  asian?: number
  africanAmerican?: number
  hispanic?: number

  // Viability
  viability?: Viability
}

export interface PathToVictory {
  id: number
  createdAt: string
  updatedAt: string
  campaignId: number
  data: PathToVictoryData
}
