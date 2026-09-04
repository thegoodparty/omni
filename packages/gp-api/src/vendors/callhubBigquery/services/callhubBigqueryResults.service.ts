import { Injectable, NotImplementedException } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { CallhubBigqueryClientService } from './callhubBigqueryClient.service'

export interface ConnectedCountWindow {
  start: Date
  end: Date
}

// PROVISIONAL — the one thing this whole module exists to eventually do, left
// deliberately unbuilt. Reads the count of CONNECTED (answered) calls for one
// voice-broadcast campaign from CallHub's BigQuery export, so a run can be
// billed on actual connected calls (hold + capture-actual) instead of the
// vendor's per-campaign results API, which cannot return this.
//
// BLOCKED on the confirmed schema — every one of these is unknown until CallHub
// grants access and we probe the dataset (see scripts/probeBigquery.ts):
//   - the table that holds per-call rows,
//   - the campaign-id column (and whether it matches our `pk_str`),
//   - the disposition / connected-status column and its "connected" value,
//   - the call-timestamp column used to bound the run's window.
// Do NOT implement the SQL by guessing these; wire it only against a probed,
// confirmed schema.
@Injectable()
export class CallhubBigqueryResultsService {
  // The client is injected now so the dependency is visible and the real query
  // has somewhere to run; it stays unused until the schema is confirmed.
  constructor(
    private readonly logger: PinoLogger,
    private readonly client: CallhubBigqueryClientService,
  ) {
    this.logger.setContext(CallhubBigqueryResultsService.name)
  }

  // MONEY-SAFETY CONTRACT (bake into the real implementation, do not soften):
  // a missing table, an ambiguous / unmatched campaign id, or a NULL count MUST
  // throw a permanent error — never return 0. A wrong 0 would report "nobody was
  // connected" and UNDER-BILL the run. Only a real, non-null count of connected
  // calls may be returned. This mirrors the CallFire getCompletedCount
  // "throws-not-0-on-null" rule.
  async getConnectedCount(
    campaignRef: string,
    window: ConnectedCountWindow,
  ): Promise<number> {
    void campaignRef
    void window
    void this.client
    throw new NotImplementedException(
      'CallHub BigQuery connected-count read is not implemented: blocked on ' +
        'confirmed dataset schema (see probeBigquery.ts)',
    )
  }
}
