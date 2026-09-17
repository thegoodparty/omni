import { Injectable } from '@nestjs/common'
import { isAxiosError } from 'axios'
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

// CallHub returns HTTP 400 { data: { error: "We are currently unable to offer
// your requested numbers" } } when it has no number for the requested area-code
// prefix — it does NOT silently substitute a national number. Matching this
// specific message (any other 400 is a genuine bad request that must still
// fail) lets rentNumber retry without the prefix for a national number.
const NO_INVENTORY_FOR_PREFIX = 'unable to offer your requested numbers'

interface CallhubRentErrorBody {
  data?: { error?: string }
}

const isNoInventoryForPrefix = (error: unknown): boolean =>
  isAxiosError<CallhubRentErrorBody>(error) &&
  (error.response?.data?.data?.error
    ?.toLowerCase()
    .includes(NO_INVENTORY_FOR_PREFIX) ??
    false)

interface RentNumberParams {
  countryIso: string
  // 3-digit area code to prefer; if CallHub has no number for it, rentNumber
  // retries without the prefix for a national number rather than failing.
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
      // No inventory for the requested area code: retry once without the prefix
      // for a national number. The recursion terminates because the retry has
      // no prefix, so a failing national rental surfaces here as a 502.
      if (params.areaCodePrefix && isNoInventoryForPrefix(error)) {
        this.logger.warn(
          { areaCodePrefix: params.areaCodePrefix },
          `CallHub had no inventory for area code ${params.areaCodePrefix}; renting a national number instead`,
        )
        return this.rentNumber({ countryIso: params.countryIso })
      }
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
