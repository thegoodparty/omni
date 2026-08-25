import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { DncContactsPageSchema } from '../schemas/callhubDnc.schema'
import { CallhubErrorHandlingService } from './callhubErrorHandling.service'
import { CallhubHttpService } from './callhubHttp.service'

const DNC_PATH = '/v1/dnc_contacts/'
const PAGE_SIZE = 1000
// Safety cap so a huge account DNC list can't page forever.
const MAX_PAGES = 200

// US 10-digit key: strip non-digits, drop a leading country '1'. Lets an
// audience number in any format ('+18557492163', '855-749-2163') match a DNC
// entry stored differently.
export const dncKey = (raw: string): string => {
  const digits = raw.replace(/\D/g, '')
  return digits.length === 11 && digits.startsWith('1')
    ? digits.slice(1)
    : digits
}

export interface DncPartition {
  dialable: string[]
  suppressed: string[]
}

// CallHub has no scrub endpoint, so we download the account DNC list and diff.
// NOTE: federal DNC / litigator / cell-block scrubbing happens at CallHub dial
// time, not here — this only removes account-level DNC entries, so the count
// is an estimate the pre-charge reachable count leans on, not the final
// dialable set.
@Injectable()
export class CallhubDncService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly http: CallhubHttpService,
    private readonly errorHandling: CallhubErrorHandlingService,
  ) {
    this.logger.setContext(CallhubDncService.name)
  }

  async loadDncKeys(): Promise<Set<string>> {
    const keys = new Set<string>()
    try {
      let path: string | null = `${DNC_PATH}?page_size=${PAGE_SIZE}`
      for (let page = 0; path && page < MAX_PAGES; page++) {
        const parsed = DncContactsPageSchema.parse(await this.http.get(path))
        for (const contact of parsed.results) {
          keys.add(dncKey(contact.phone_number))
        }
        // `next` is an absolute URL; the http service prepends baseURL, so pass
        // just the path + query.
        path = parsed.next ? parsed.next.replace(/^https?:\/\/[^/]+/, '') : null
      }
      return keys
    } catch (error) {
      return this.errorHandling.handleApiError({
        error,
        logger: this.logger,
        customMessage: 'CallHub DNC list fetch failed',
      })
    }
  }

  // Splits an audience into dialable vs. DNC-suppressed numbers so the caller
  // can charge/report on the dialable count.
  async partitionByDnc(numbers: string[]): Promise<DncPartition> {
    const dncKeys = await this.loadDncKeys()
    const dialable: string[] = []
    const suppressed: string[] = []
    for (const number of numbers) {
      if (dncKeys.has(dncKey(number))) suppressed.push(number)
      else dialable.push(number)
    }
    return { dialable, suppressed }
  }
}
