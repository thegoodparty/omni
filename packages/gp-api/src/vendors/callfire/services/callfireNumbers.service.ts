import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { NoInventoryError } from '../noInventoryError'
import {
  CallfireNumber,
  CallfireNumberListSchema,
  CallfireOrderResourceIdSchema,
} from '../schemas/callfireNumbers.schema'
import { CallfireErrorHandlingService } from './callfireErrorHandling.service'
import { CallfireHttpService } from './callfireHttp.service'

const LOCAL_NUMBERS_PATH = '/numbers/local'
const PURCHASE_NUMBERS_PATH = '/orders/numbers'
// CallFire's `limit` when the caller doesn't cap the search.
const DEFAULT_SEARCH_LIMIT = 20

interface SearchLocalNumbersParams {
  // 3-digit area code, sent as CallFire's `prefix` query param.
  areaCode: string
  // Two-letter state code (optional narrowing filter).
  state?: string
  // Max results, sent as CallFire's `limit`.
  count?: number
}

interface RentNumberParams {
  areaCode: string
  state?: string
}

export interface CallfireRentedNumber {
  phoneNumber: string
  // Two-letter state code from the number's region, when known.
  region?: string
}

// CallFire local-number search + rental. A rental is a real recurring charge,
// so callers rent once per candidate and reuse the number.
@Injectable()
export class CallfireNumbersService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly http: CallfireHttpService,
    private readonly errorHandling: CallfireErrorHandlingService,
  ) {
    this.logger.setContext(CallfireNumbersService.name)
  }

  async searchLocalNumbers(
    params: SearchLocalNumbersParams,
  ): Promise<CallfireNumber[]> {
    try {
      const data = await this.http.get(LOCAL_NUMBERS_PATH, {
        params: {
          prefix: params.areaCode,
          state: params.state,
          limit: params.count ?? DEFAULT_SEARCH_LIMIT,
        },
      })
      return CallfireNumberListSchema.parse(data).items
    } catch (error) {
      return this.errorHandling.handleApiError({
        error,
        logger: this.logger,
        customMessage: 'CallFire local-number search failed',
      })
    }
  }

  // REAL billable order: buys a local number and returns it. NEVER invoke this
  // in a test. We search first so we can order a specific number and return it
  // — POST /orders/numbers only echoes an order id, not the purchased number.
  async rentNumber(params: RentNumberParams): Promise<CallfireRentedNumber> {
    const [candidate] = await this.searchLocalNumbers({
      areaCode: params.areaCode,
      state: params.state,
      count: 1,
    })
    if (!candidate) {
      throw new NoInventoryError(
        `No CallFire local number available for area code ${params.areaCode}`,
      )
    }

    try {
      const data = await this.http.post(PURCHASE_NUMBERS_PATH, {
        numbers: [candidate.number],
      })
      CallfireOrderResourceIdSchema.parse(data)
      return {
        phoneNumber: candidate.number,
        region: candidate.region?.state ?? undefined,
      }
    } catch (error) {
      return this.errorHandling.handleApiError({
        error,
        logger: this.logger,
        customMessage: 'CallFire number purchase failed',
      })
    }
  }
}
