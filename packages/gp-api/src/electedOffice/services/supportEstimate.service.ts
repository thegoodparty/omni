import { Injectable } from '@nestjs/common'
import { SupportEstimate } from '@goodparty_org/contracts'
import { ElectedOfficeSupportApiService } from './electedOfficeSupportApi.service'

@Injectable()
export class SupportEstimateService {
  constructor(private readonly supportApi: ElectedOfficeSupportApiService) {}

  // Reads the office's constituent-support row from election-api (populated by
  // the data team's ETL) and shapes it for the Serve dashboard hero. Returns
  // null until a usable row exists, so the UI can show a "no estimate yet"
  // state rather than fabricated numbers.
  async getSupportEstimate(
    electedOfficeId: string,
  ): Promise<SupportEstimate | null> {
    const support = await this.supportApi.getByElectedOfficeId(electedOfficeId)
    if (!support || support.totalConstituents <= 0) {
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
