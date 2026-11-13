import { Prisma } from '../generated/prisma'
import type { BallotStatus } from './schemas/ballotStatus.schema'
import type { SignupGoal } from './schemas/signupGoal.schema'

export type CampaignWith<T extends keyof Prisma.CampaignInclude> =
  Prisma.CampaignGetPayload<{ include: { [field in T]: true } }>

export type CampaignListResponse = Prisma.CampaignGetPayload<{
  include: {
    user: {
      select: {
        firstName: true
        lastName: true
        phone: true
        email: true
        metaData: true
      }
    }
  }
}>

export interface UpdateCampaignFieldsInput {
  data?: Record<string, unknown>
  details?: Record<string, unknown>
  formattedAddress?: string | null
  placeId?: string | null
  canDownloadFederal?: boolean
  overrideDistrictId?: string | null
  primaryResult?: 'won' | 'lost' | null
  ballotStatus?: BallotStatus | null
  signupGoal?: SignupGoal | null
}
