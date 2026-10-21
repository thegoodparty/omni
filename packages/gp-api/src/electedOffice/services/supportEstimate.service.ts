import { Injectable } from '@nestjs/common'
import {
  ElectedOfficeSupport,
  ElectedOfficeSupportSchema,
  SupportEstimate,
} from '@goodparty_org/contracts'
import { ElectedOfficeSupportService } from '@/electionDb/electedOfficeSupport/electedOfficeSupport.service'

@Injectable()
export class SupportEstimateService {
  constructor(
    private readonly electedOfficeSupport: ElectedOfficeSupportService,
  ) {}

  // Reads the office's constituent-support row from the election database
  // (populated by the data team's ETL) and shapes it for the Serve dashboard
  // hero. Returns null until a usable row exists, so the UI can show a "no
  // estimate yet" state rather than fabricated numbers.
  async getSupportEstimate(
    electedOfficeId: string,
  ): Promise<SupportEstimate | null> {
    const row =
      await this.electedOfficeSupport.getByElectedOfficeId(electedOfficeId)
    if (!row) {
      return null
    }
    // Narrow the Prisma row to the published contract: createdAt/updatedAt
    // are not part of it and must not reach a gp-api response.
    const support: ElectedOfficeSupport = ElectedOfficeSupportSchema.parse(row)
    if (support.totalConstituents <= 0) {
      return null
    }
    const rawPercent =
      (support.supportConstituents / support.totalConstituents) * 100
    return {
      likelySupport: support.supportConstituents,
      districtSize: support.totalConstituents,
      // Clamp + round to one decimal; the schema bounds this to [0, 100].
      percentOfDistrict: Math.min(100, Math.round(rawPercent * 10) / 10),
    }
  }
}
