import { CommitteeType, OfficeLevel } from '../../../generated/prisma'
import { BallotReadyPositionLevel } from '@goodparty_org/contracts'
import { PeerlyCommitteeType } from '../peerly.types'

export const PEERLY_ENTITY_TYPE = 'NON_PROFIT'
export const PEERLY_USECASE = 'POLITICAL'

// Peerly identity profile status before the 10DLC usecase is submitted. Once
// approve10DLCBrand runs, the profile advances to `waiting_to_finalize` and then
// `finalized`, so `pending` is the marker that a usecase still needs submitting.
export const PEERLY_PROFILE_STATUS_PENDING = 'pending'

// Terminal profile status after the 10DLC brand is approved. A finalized brand
// rejects a second /approve ("status must be pending, not finalized"), so a CV
// token attached after finalization has to go through /submit instead.
export const PEERLY_PROFILE_STATUS_FINALIZED = 'finalized'

// Profile status between /approve or /submit (CV token attached) and Peerly's
// own /finalize confirmation reaching MNO review. A brand stuck here past a
// business-day floor is a Peerly-side stall, not ours (ENG-10796 case 3b).
export const PEERLY_PROFILE_STATUS_WAITING_TO_FINALIZE = 'waiting_to_finalize'

export enum PeerlyLocalities {
  local = 'local',
  state = 'state',
  federal = 'federal',
}

export const getPeerlyLocaleFromOfficeLevel = (
  officeLevel: OfficeLevel,
): PeerlyLocalities => {
  switch (officeLevel) {
    case OfficeLevel.federal:
      return PeerlyLocalities.federal
    case OfficeLevel.state:
      return PeerlyLocalities.state
    case OfficeLevel.local:
      return PeerlyLocalities.local
  }
}

export const getPeerlyCommitteeType = (
  committeeType: CommitteeType,
): PeerlyCommitteeType => {
  switch (committeeType) {
    case CommitteeType.HOUSE:
      return PeerlyCommitteeType.House
    case CommitteeType.SENATE:
      return PeerlyCommitteeType.Senate
    case CommitteeType.PRESIDENTIAL:
      return PeerlyCommitteeType.Presidential
    case CommitteeType.CANDIDATE:
      return PeerlyCommitteeType.Candidate
  }
}

export const PEERLY_LOCALITY_CATEGORIES: Record<
  PeerlyLocalities,
  BallotReadyPositionLevel[]
> = {
  [PeerlyLocalities.local]: [
    BallotReadyPositionLevel.CITY,
    BallotReadyPositionLevel.COUNTY,
    BallotReadyPositionLevel.LOCAL,
    BallotReadyPositionLevel.REGIONAL,
    BallotReadyPositionLevel.TOWNSHIP,
  ],
  [PeerlyLocalities.state]: [BallotReadyPositionLevel.STATE],
  [PeerlyLocalities.federal]: [BallotReadyPositionLevel.FEDERAL],
}
