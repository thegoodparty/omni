import { Injectable } from '@nestjs/common'
import { isAfter } from 'date-fns'
import { Eligibility } from '@goodparty_org/contracts'
import { ElectedOffice } from '../../generated/prisma'
import { CampaignsService } from './campaigns.service'
import { ElectedOfficeService } from '@/electedOffice/services/electedOffice.service'
import { isActiveCampaign, isHeldOffice } from '../util/eligibility.util'

@Injectable()
export class EligibilityService {
  constructor(
    private readonly campaigns: CampaignsService,
    private readonly electedOffices: ElectedOfficeService,
  ) {}

  async evaluate(userId: number): Promise<Eligibility> {
    const [campaigns, electedOffices] = await Promise.all([
      this.campaigns.findMany({ where: { userId } }),
      this.electedOffices.findMany({ where: { userId } }),
    ])

    const now = new Date()

    const hasActiveCampaign = campaigns.some((campaign) =>
      isActiveCampaign(campaign, now),
    )

    const heldOffice = electedOffices.find((office) =>
      isHeldOffice(office, now),
    )
    const reelectionOffice = heldOffice ?? this.mostRecentOffice(electedOffices)

    const holdsOffice = Boolean(heldOffice)

    return {
      hasActiveCampaign,
      holdsOffice,
      canStartCampaign: !hasActiveCampaign,
      canGainOffice: !holdsOffice,
      reelectionOfficeSlug: reelectionOffice?.organizationSlug ?? null,
    }
  }

  private mostRecentOffice(
    offices: ElectedOffice[],
  ): ElectedOffice | undefined {
    return offices.reduce<ElectedOffice | undefined>(
      (latest, office) =>
        !latest ||
        isAfter(this.officeRecency(office), this.officeRecency(latest))
          ? office
          : latest,
      undefined,
    )
  }

  // termStartDate is the semantic "most recently held"; fall back to
  // termEndDate then createdAt for rows where term dates were never populated
  // (e.g. backfill / import) so createdAt order can't pick the wrong office.
  private officeRecency(office: ElectedOffice): Date {
    return office.termStartDate ?? office.termEndDate ?? office.createdAt
  }
}
