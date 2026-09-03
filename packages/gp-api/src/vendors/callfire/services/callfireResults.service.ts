import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { CompletedCount } from '@/outreach/vendor/robocallVendor.types'
import {
  CallBroadcastStats,
  CallBroadcastStatsSchema,
  CallfireCall,
  CallPageSchema,
} from '../schemas/callfireResults.schema'
import { CallfireErrorHandlingService } from './callfireErrorHandling.service'
import { CallfireHttpService } from './callfireHttp.service'

const BROADCAST_PATH = '/calls/broadcasts'
const CALLS_PATH = '/calls'
const CALLS_PAGE_LIMIT = 1000
// Safety cap so a huge broadcast can't page forever.
const MAX_PAGES = 200

// Read-only results/stats for a CallFire call broadcast. Every call here is a
// GET: it reads post-run figures, it never creates, launches, or dials.
@Injectable()
export class CallfireResultsService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly http: CallfireHttpService,
    private readonly errorHandling: CallfireErrorHandlingService,
  ) {
    this.logger.setContext(CallfireResultsService.name)
  }

  // Parses OUTSIDE the fetch try/catch, so a schema mismatch surfaces as a
  // ZodError (a permanent bug) rather than the transient-looking
  // BadGatewayException a stats poll would otherwise retry on. Mirrors the
  // CallHub completion-poll reasoning — this count feeds capture.
  async getBroadcastStats(campaignRef: string): Promise<CallBroadcastStats> {
    const data = await this.fetchStats(campaignRef)
    return CallBroadcastStatsSchema.parse(data)
  }

  private async fetchStats(campaignRef: string) {
    try {
      return await this.http.get(`${BROADCAST_PATH}/${campaignRef}/stats`)
    } catch (error) {
      return this.errorHandling.handleApiError({
        error,
        logger: this.logger,
        customMessage: 'CallFire broadcast stats lookup failed',
      })
    }
  }

  // THE connected-count definition (money path — capture bills on this count).
  //
  // connected = callsLiveAnswer: a live human answered. Whether
  // answeringMachineCount (voicemail drop) should ALSO count as connected is a
  // product/billing decision (see the migration plan); until that is settled we
  // bill live-answer only. If that changes, change the count HERE and nowhere
  // else.
  //
  // callsLiveAnswer must be present. A stats payload that omits it is NOT
  // treated as zero connected calls — that would silently under-bill — so we
  // throw and let the missing count surface as a bug. A genuine 0 (zero live
  // answers) is a valid count and passes through unchanged.
  async getCompletedCount(campaignRef: string): Promise<CompletedCount> {
    const stats = await this.getBroadcastStats(campaignRef)
    if (stats.callsLiveAnswer == null) {
      throw new Error(
        'CallFire stats missing callsLiveAnswer; ' +
          'refusing to derive a connected count',
      )
    }
    return {
      connectedCount: stats.callsLiveAnswer,
      billableSeconds: stats.callsDuration ?? null,
    }
  }

  // Auditable cross-check for the stats count: the per-call disposition
  // (finalCallResult) for every call in the broadcast. The stats endpoint above
  // is the primary count source; this exists to reconcile a disputed bill.
  async findCalls(campaignRef: string): Promise<CallfireCall[]> {
    const calls: CallfireCall[] = []
    let offset = 0
    for (let page = 0; page < MAX_PAGES; page++) {
      const parsed = CallPageSchema.parse(
        await this.fetchCallsPage(campaignRef, offset),
      )
      const items = parsed.items ?? []
      calls.push(...items)
      const limit = parsed.limit ?? CALLS_PAGE_LIMIT
      if (items.length < limit) break
      offset += limit
    }
    return calls
  }

  private async fetchCallsPage(campaignRef: string, offset: number) {
    const path =
      `${CALLS_PATH}?campaignId=${campaignRef}` +
      `&limit=${CALLS_PAGE_LIMIT}&offset=${offset}`
    try {
      return await this.http.get(path)
    } catch (error) {
      return this.errorHandling.handleApiError({
        error,
        logger: this.logger,
        customMessage: 'CallFire calls lookup failed',
      })
    }
  }
}
