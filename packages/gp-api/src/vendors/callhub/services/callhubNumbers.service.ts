import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import {
  CALLHUB_VB_CAMPAIGN_TYPE,
  CallhubRentedNumber,
  CallhubRentedNumberSchema,
  RentedNumbersPageSchema,
} from '../schemas/callhubNumber.schema'
import { CallhubErrorHandlingService } from './callhubErrorHandling.service'
import { CallhubHttpService } from './callhubHttp.service'

const RENT_PATH = '/v1/numbers/rent/'
const RENTED_LIST_PATH = '/v1/numbers/rented_calling_numbers/'
const RENTED_LIST_PAGE_SIZE = 1000

interface RentNumberParams {
  countryIso: string
  // 3-digit area code to try; CallHub falls back to a random national number
  // if that prefix has no inventory (caller must verify the returned number).
  areaCodePrefix?: string
}

// Voice-broadcast caller-ID number rental/lookup. A rental carries a recurring
// charge, so callers rent once per candidate and reuse the number.
@Injectable()
export class CallhubNumbersService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly http: CallhubHttpService,
    private readonly errorHandling: CallhubErrorHandlingService,
  ) {
    this.logger.setContext(CallhubNumbersService.name)
  }

  async rentNumber(params: RentNumberParams): Promise<CallhubRentedNumber> {
    try {
      const data = await this.http.post(RENT_PATH, {
        country_iso: params.countryIso,
        phone_number_prefix: params.areaCodePrefix,
        campaign_type: CALLHUB_VB_CAMPAIGN_TYPE,
      })
      return CallhubRentedNumberSchema.parse(data)
    } catch (error) {
      return this.errorHandling.handleApiError({
        error,
        logger: this.logger,
        customMessage: 'CallHub number rental failed',
      })
    }
  }

  async listRentedNumbers(): Promise<CallhubRentedNumber[]> {
    try {
      const data = await this.http.get(RENTED_LIST_PATH, {
        params: { page_size: RENTED_LIST_PAGE_SIZE },
      })
      return RentedNumbersPageSchema.parse(data).results
    } catch (error) {
      return this.errorHandling.handleApiError({
        error,
        logger: this.logger,
        customMessage: 'CallHub rented-number lookup failed',
      })
    }
  }
}
