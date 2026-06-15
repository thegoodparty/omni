import { Injectable } from '@nestjs/common'
import { SupportEstimate } from '@goodparty_org/contracts'

@Injectable()
export class SupportEstimateService {
  // TODO: data + research own a table keyed on electedOfficeId (analogous to
  // the Win number) holding the estimate and its components. When it lands,
  // replace this interim value with a read of that table by electedOfficeId.
  // Confirm the table name, key, and columns with data + research (Bryan).
  getSupportEstimate(_electedOfficeId: string): SupportEstimate {
    return {
      likelySupport: 1240,
      districtSize: 5200,
      percentOfDistrict: 23.8,
      trendVsLastMonth: 2.1,
    }
  }
}
