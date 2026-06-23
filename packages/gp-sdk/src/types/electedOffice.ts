import type { PaginationOptions } from '@goodparty_org/contracts'

export type ElectedOffice = {
  id: string
  organizationSlug: string
  electedDate: string | null
  swornInDate: string | null
  termStartDate: string | null
  termEndDate: string | null
  termLengthDays: number | null
  isActive: boolean
  party: string | null
  pledgedAt: string | null
  onboardingCompletedAt: string | null
  // True when the holder self-reported their office/term via the net-new serve
  // onboarding flow (vs a sales/BallotReady prefill).
  selfReported: boolean
  // Resume checkpoint: the furthest serve-onboarding step the holder reached.
  onboardingStep: string | null
  userId: number
  campaignId: number | null
  createdAt: string
  updatedAt: string
}

export type ListElectedOfficesOptions = PaginationOptions & {
  userId?: number
}

// isActive and termLengthDays are derived server-side from the term dates and
// are not writable, so they are intentionally absent from the write inputs
// (they remain on the ElectedOffice response type above).
export type UpdateElectedOfficeInput = {
  electedDate?: string | null
  swornInDate?: string | null
  termStartDate?: string | null
  termEndDate?: string | null
  party?: string | null
  pledgedAt?: string | null
  onboardingCompletedAt?: string | null
  selfReported?: boolean
  onboardingStep?: string | null
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
