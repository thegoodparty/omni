export interface ElectedOffice {
  id: string
  createdAt: string
  updatedAt: string
  userId: number
  campaignId: number
  electedDate: string | null
  swornInDate: string | null
  termStartDate: string | null
  termLengthDays: number | null
  termEndDate: string | null
  isActive: boolean
}
