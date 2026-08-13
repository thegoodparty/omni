import type { PaginationOptions } from '@goodparty_org/contracts'

// The response shape is owned by @goodparty_org/contracts; re-exported so SDK
// consumers import it from the SDK surface without a shadow definition.
export type { ElectedOffice } from '@goodparty_org/contracts'

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
