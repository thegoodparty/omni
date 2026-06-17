import type { PaginationOptions } from '@goodparty_org/contracts'

export type ElectedOffice = {
  id: string
  electedDate: string | null
  swornInDate: string | null
  termStartDate: string | null
  termEndDate: string | null
  termLengthDays: number | null
  isActive: boolean
  party: string | null
  pledgedAt: string | null
  onboardingCompletedAt: string | null
  userId: number
  campaignId: number | null
  createdAt: string
  updatedAt: string
}

export type ListElectedOfficesOptions = PaginationOptions & {
  userId?: number
}

export type UpdateElectedOfficeInput = {
  electedDate?: string | null
  swornInDate?: string | null
  termStartDate?: string | null
  termEndDate?: string | null
  termLengthDays?: number | null
  isActive?: boolean
  party?: string | null
  pledgedAt?: string | null
  onboardingCompletedAt?: string | null
}

export type CreateElectedOfficeInput = UpdateElectedOfficeInput & {
  ballotReadyPositionId?: string | null
  customPositionName?: string | null
  overrideDistrictId?: string | null
}

export type UpdateElectedOfficeDistrictInput = {
  state: string
  L2DistrictType: string
  L2DistrictName: string
}

export type SetElectedOfficeDistrictOutput = {
  electedOfficeId: string
  overrideDistrictId: string | null
}
