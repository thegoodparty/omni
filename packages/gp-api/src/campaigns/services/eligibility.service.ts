import { Injectable } from '@nestjs/common'
import { isAfter, isValid } from 'date-fns'
import { Eligibility } from '@goodparty_org/contracts'
import { getMidnightForDate, parseIsoDateAsUTC } from '@/shared/util/date.util'
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
    if (campaign.isDemo) return false
    const electionDate = campaign.details?.electionDate
    if (!electionDate) return false
    const parsed = parseIsoDateAsUTC(electionDate)
    if (!isValid(parsed)) return false
    // electionDate is a calendar date (UTC midnight); the campaign stays
    // active through the whole election day, so compare UTC calendar days
    // rather than the parsed instant — date-fns endOfDay is local-time and
    // would flip the boundary on non-UTC servers.
    return campaign.didWin === null && !isAfter(getMidnightForDate(now), parsed)
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
        !latest ||
        isAfter(this.officeRecency(office), this.officeRecency(latest))
          ? office
          : latest,
      undefined,
    )
  }

  // termStartAt is the semantic "most recently held"; fall back to termEndAt
  // then createdAt for rows where term dates were never populated (e.g.
  // backfill / import) so createdAt order can't pick the wrong office.
  private officeRecency(office: ElectedOffice): Date {
    return office.termStartAt ?? office.termEndAt ?? office.createdAt
  }
}
