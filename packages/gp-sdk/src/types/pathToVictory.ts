import type { PaginationOptions } from '@goodparty_org/contracts'

export enum P2VStatus {
  complete = 'Complete',
  waiting = 'Waiting',
  failed = 'Failed',
  districtMatched = 'DistrictMatched',
}

export enum P2VSource {
  GpApi = 'GpApi',
  ElectionApi = 'ElectionApi',
}

export type ViabilityScore = {
  level: string
  isPartisan: boolean
  isIncumbent: boolean
  isUncontested: boolean
  candidates: number
  seats: number
  candidatesPerSeat: number
  score: number
  probOfWin: number
}

export type PathToVictoryData = {
  p2vStatus?: P2VStatus
  p2vAttempts?: number
  p2vCompleteDate?: string
  completedBy?: number
  electionType?: string
  electionLocation?: string
  voterContactGoal?: number
  winNumber?: number
  p2vNotNeeded?: boolean
  totalRegisteredVoters?: number
  republicans?: number
  democrats?: number
  indies?: number
  women?: number
  men?: number
  white?: number
  asian?: number
  africanAmerican?: number
  hispanic?: number
  averageTurnout?: number
  projectedTurnout?: number
  viability?: ViabilityScore
  source?: P2VSource
  districtId?: string
  districtManuallySet?: boolean
  officeContextFingerprint?: string
}

export type PathToVictory = {
  id: number
  createdAt: string
  updatedAt: string
  campaignId: number
  data: PathToVictoryData
}

export type ListPathsToVictoryOptions = PaginationOptions & {
  userId?: number
}

export type UpdatePathToVictoryInput = {
  data: PathToVictoryData
}
