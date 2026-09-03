import { Injectable } from '@nestjs/common'
import { DoorKnockingQuotaResponse } from '@goodparty_org/contracts'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { Organization } from '../../generated/prisma'
import {
  campaignsRemaining,
  dailyCampaignLimit,
} from '../utils/campaignQuota.util'

// The daily gate, read ahead of the create flow so it can refuse to open on a
// spent day rather than walk a candidate through five steps and 429 at the
// end. It used to answer two allowances; the 500-stop budget beside this one
// has been removed.
//
// Both numbers come from the util the create transaction's own assert calls,
// which is what keeps this read and the refusal it pre-empts quoting the same
// allowance — including for an organization an admin has raised.
@Injectable()
export class DoorKnockingQuotaService extends createPrismaBase(
  MODELS.DoorKnockingTurf,
) {
  async read(organization: Organization): Promise<DoorKnockingQuotaResponse> {
    return {
      campaignsRemaining: await campaignsRemaining(this.client, organization),
      campaignLimit: dailyCampaignLimit(organization),
    }
  }
}
