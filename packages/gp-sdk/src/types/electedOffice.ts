import type { PaginationOptions } from '@goodparty_org/contracts'

export type ElectedOffice = {
  id: string
  electedDate: string | null
  swornInDate: string | null
  termStartDate: string | null
  termEndDate: string | null
  termLengthDays: number | null
  isActive: boolean
  userId: number
  campaignId: number
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
