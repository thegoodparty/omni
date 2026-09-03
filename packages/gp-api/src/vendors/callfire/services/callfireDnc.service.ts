import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { DncPartition } from '@/outreach/vendor/robocallVendor.types'
import { DoNotContactPageSchema } from '../schemas/callfireDnc.schema'
import { CallfireErrorHandlingService } from './callfireErrorHandling.service'
import { CallfireHttpService } from './callfireHttp.service'

const DNC_PATH = '/contacts/dncs'
const PAGE_LIMIT = 1000
// Safety cap so a huge account DNC list can't page forever.
const MAX_PAGES = 200

// US 10-digit key: strip non-digits, drop a leading country '1'. Lets an
// audience number in any format ('+18557492163', '855-749-2163') match a DNC
// entry CallFire stores in E.164 11-digit form ('18557492163').
export const dncKey = (raw: string): string => {
  const digits = raw.replace(/\D/g, '')
  return digits.length === 11 && digits.startsWith('1')
    ? digits.slice(1)
    : digits
}

// CallFire exposes an account DNC list at GET /contacts/dncs (?call=true =
// Do-Not-Call numbers). There is no per-audience scrub endpoint, so — like the
// CallHub adapter — we page the whole list and diff locally.
// NOTE: federal DNC / litigator / cell-block scrubbing happens at CallFire dial
// time, not here — this only removes account-level DNC entries, so the callable
// count is a pre-dial estimate the reachable count leans on, not the final
// dialed set.
@Injectable()
export class CallfireDncService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly http: CallfireHttpService,
    private readonly errorHandling: CallfireErrorHandlingService,
  ) {
    this.logger.setContext(CallfireDncService.name)
  }

  async loadDncKeys(): Promise<Set<string>> {
    const keys = new Set<string>()
    try {
      let offset = 0
      for (let page = 0; page < MAX_PAGES; page++) {
        const parsed = DoNotContactPageSchema.parse(
          await this.http.get(
            `${DNC_PATH}?call=true&limit=${PAGE_LIMIT}&offset=${offset}`,
          ),
        )
        const items = parsed.items ?? []
        for (const item of items) keys.add(dncKey(item.number))
        const limit = parsed.limit ?? PAGE_LIMIT
        if (items.length < limit) break
        offset += limit
      }
      return keys
    } catch (error) {
      return this.errorHandling.handleApiError({
        error,
        logger: this.logger,
        customMessage: 'CallFire DNC list fetch failed',
      })
    }
  }

  // Splits an audience into callable vs. DNC-suppressed numbers so the caller
  // can charge/report on the callable count.
  async partitionByDnc(numbers: string[]): Promise<DncPartition> {
    const dncKeys = await this.loadDncKeys()
    const callable: string[] = []
    const dnc: string[] = []
    for (const number of numbers) {
      if (dncKeys.has(dncKey(number))) dnc.push(number)
      else callable.push(number)
    }
    return { callable, dnc }
  }
}
