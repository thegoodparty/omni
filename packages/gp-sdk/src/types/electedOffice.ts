import type { PaginationOptions } from './result'

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
