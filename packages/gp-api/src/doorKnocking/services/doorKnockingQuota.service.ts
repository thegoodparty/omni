import { Injectable } from '@nestjs/common'
import { DoorKnockingQuotaResponse } from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { Organization } from '../../generated/prisma'
import {
  campaignsRemaining,
  DAILY_CAMPAIGN_LIMIT,
} from '../utils/campaignQuota.util'
import {
  dailyWaypointLimit,
  waypointsRemaining,
} from '../utils/waypointQuota.util'

// The two daily gates, answered in one read so the create flow does not have
// to ask twice or infer one from the other. Both numbers come from the utils
// the create transaction's own asserts call, which is what keeps this read
// and the refusal it is meant to pre-empt quoting the same allowance.
//
// The two windows are counted from different sources and cannot be folded
// together: campaigns are turf rows, waypoints are ledger rows, and a
// rolled-back create leaves the second without the first.
@Injectable()
export class DoorKnockingQuotaService extends createPrismaBase(
  MODELS.DoorKnockingTurf,
) {
  async read(organization: Organization): Promise<DoorKnockingQuotaResponse> {
    const [campaigns, waypoints] = await Promise.all([
      campaignsRemaining(this.client, organization.slug),
      waypointsRemaining(this.client, organization),
    ])
    return {
      campaignsRemaining: campaigns,
      campaignLimit: DAILY_CAMPAIGN_LIMIT,
      waypointsRemaining: waypoints,
      waypointLimit: dailyWaypointLimit(organization),
    }
  }
}
