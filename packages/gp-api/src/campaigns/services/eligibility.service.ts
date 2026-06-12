import { Injectable } from '@nestjs/common'
import { isAfter, isValid } from 'date-fns'
import { Eligibility } from '@goodparty_org/contracts'
import { parseIsoDateAsUTC } from '@/shared/util/date.util'
import { ElectedOfficeService } from '@/electedOffice/services/electedOffice.service'
import { Campaign, ElectedOffice } from '../../generated/prisma'
import { CampaignsService } from './campaigns.service'

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
      this.isActiveCampaign(campaign, now),
    )

    const heldOffice = electedOffices.find((office) =>
      this.holdsOffice(office, now),
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

  private isActiveCampaign(campaign: Campaign, now: Date): boolean {
    const electionDate = campaign.details?.electionDate
    if (!electionDate) return false
    const parsed = parseIsoDateAsUTC(electionDate)
    if (!isValid(parsed)) return false
    return campaign.didWin === null && isAfter(parsed, now)
  }

  private holdsOffice(office: ElectedOffice, now: Date): boolean {
    return (
      office.isActive &&
      (office.termEndAt === null || isAfter(office.termEndAt, now))
    )
  }

  private mostRecentOffice(
    offices: ElectedOffice[],
  ): ElectedOffice | undefined {
    return offices.reduce<ElectedOffice | undefined>(
      (latest, office) =>
        !latest || isAfter(office.createdAt, latest.createdAt)
          ? office
          : latest,
      undefined,
    )
  }
}
