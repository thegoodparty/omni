import { BadRequestException, Injectable } from '@nestjs/common'
import { isAxiosError } from 'axios'
import { addDays, isAfter } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import { PinoLogger } from 'nestjs-pino'
import {
  CALLHUB_VB_STATUS,
  CreateVbCampaignBody,
  CreateVbCampaignResponse,
  CreateVbCampaignResponseSchema,
  LaunchVbCampaignResponse,
  LaunchVbCampaignResponseSchema,
} from '../schemas/callhubCampaign.schema'
import { CallhubErrorHandlingService } from './callhubErrorHandling.service'
import { CallhubHttpService } from './callhubHttp.service'
import {
  DAILY_START_TIME,
  DAILY_STOP_TIME,
  SCHEDULE_TZ,
} from '@/shared/util/robocallDialWindow.const'

// Trailing slash is load-bearing: POST /v1/vb_campaign (no slash) returns the
// campaign list instead of creating one.
const CREATE_PATH = '/v1/vb_campaign/'
// The per-campaign status endpoint. Trailing slash matters for the same DRF
// reason as the create path. pk_str is a STRING end-to-end — CallHub ids exceed
// JS's safe-integer range, so it is never coerced to a number.
const LAUNCH_PATH_PREFIX = '/v1/voice_broadcasts/'
// SCHEDULE_TZ / DAILY_START_TIME / DAILY_STOP_TIME are the window CallHub dials
// in, imported from the shared source the dial-completion estimator also reads
// (robocallDialWindow.const) so the two can never drift.
const CALLHUB_DATE_FORMAT = 'yyyy-MM-dd HH:mm:ss'
// How long after the start the broadcast may keep dialing before it expires —
// enough for a large landline list to drain.
const EXPIRATION_WINDOW_DAYS = 7
// Calls per minute to request on each created campaign. CallHub's account-wide
// VB cap is ~60 calls/min SHARED across RUNNING campaigns, and a new campaign
// defaults to `frequency: 60` (the whole pool), so two RUNNING at once trip
// `over_cps_limit` (incident 2026-10-08).
//
// Raised 10 → 30 on 2026-10-15: at 10/min big lists dialed slowly and, with the
// serial queue running one campaign at a time, each held the shared pool for
// hours and sends stacked up overdue. A faster per-campaign rate finishes each
// run sooner (and shortens its completion estimate), draining the queue. Safe
// now that (a) the serial gate guarantees only ONE campaign runs at a time, so
// 30 never contends with our own others; (b) R1 freezes each run's rate at
// staging, so this raise can't mis-estimate an in-flight run; and (c) the Oct
// incident showed PAUSED campaigns do NOT consume the cap (leroy ran at 60 while
// others sat Paused at 60) — only running ones do. 30 stays well under the ~60
// ceiling a single run demonstrably sustains, and a stray `over_cps` self-heals
// via startCampaign's throttle revert. Env-tunable (`CALLHUB_VB_CALLS_PER_MINUTE`)
// to push higher; raising the account cap with CallHub multiplies the ceiling.
const DEFAULT_CALLS_PER_MINUTE = 30
const callsPerMinute = (): number => {
  const raw = Number(process.env.CALLHUB_VB_CALLS_PER_MINUTE)
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_CALLS_PER_MINUTE
}

interface CreateVoiceBroadcastParams {
  name: string
  // Phonebook pk_str (string), never the numeric id — CallHub ids exceed JS's
  // safe-integer range.
  phonebookPkStr: string
  // The rented caller-ID number (CallhubNumbersService.phone_number).
  callerId: string
  // The uploaded audio's media file id (CallhubMediaService), a string for the
  // same safe-integer reason.
  mediaFileId: string
  // When the broadcast should start dialing. Must be in the future: a create is
  // always scheduled, never immediate, so no call is placed at create time.
  scheduledStart: Date
}

// The create response plus the dial window this service scheduled. The window
// is COMPUTED (start = the requested scheduledStart, expiration = start +
// EXPIRATION_WINDOW_DAYS), not read back from CallHub's echoed `schedule`, so a
// staging caller that mirrors the window never lands null columns on a
// successful create.
export interface CreateVbCampaignResult extends CreateVbCampaignResponse {
  startingDate: Date
  expirationDate: Date
  // The `frequency` (calls/min) this campaign was created with — the rate
  // CallHub dials it at. Returned so the caller can FREEZE it per-run, so the
  // dial-completion estimate reads the rate THIS campaign was staged at rather
  // than a later-raised live env value.
  callsPerMinute: number
}

// Creates a CallHub voice broadcast in a scheduled, PAUSED (not-launched)
// state, wiring together the pieces the earlier robocall slices produce (loaded
// phonebook, rented caller-ID number, uploaded audio) plus a send time.
// Launching — the PUT /v1/voice_broadcasts/{pk_str}/ status transition that
// actually dials — is a later slice this service deliberately does not expose.
@Injectable()
export class CallhubCampaignService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly http: CallhubHttpService,
    private readonly errorHandling: CallhubErrorHandlingService,
  ) {
    this.logger.setContext(CallhubCampaignService.name)
  }

  // The per-campaign calls/min `createVoiceBroadcast` stamps on every campaign it
  // creates (CALLHUB_VB_CALLS_PER_MINUTE, default DEFAULT_CALLS_PER_MINUTE). This
  // is the LIVE value; `createVoiceBroadcast` now RETURNS the rate it stamped so
  // the staging slice can FREEZE it per-run (OutreachRobocall.stagedCallsPerMinute).
  // The dial-completion estimate reads that frozen rate, falling back HERE only
  // for a run staged before the freeze — so raising this env for new campaigns no
  // longer shortens the estimate for a run already staged at the old rate (which
  // would free the pool / abort while it is still dialing).
  getConfiguredCallsPerMinute(): number {
    return callsPerMinute()
  }

  async createVoiceBroadcast(
    params: CreateVoiceBroadcastParams,
  ): Promise<CreateVbCampaignResult> {
    if (!isAfter(params.scheduledStart, new Date())) {
      throw new BadRequestException(
        'Voice broadcast must be scheduled in the future',
      )
    }

    const startingDate = params.scheduledStart
    const expirationDate = addDays(startingDate, EXPIRATION_WINDOW_DAYS)
    const frequency = callsPerMinute()
    const body: CreateVbCampaignBody = {
      name: params.name,
      phonebooks: [params.phonebookPkStr],
      frequency,
      script: {
        label: params.name,
        live_message: { audiofile: params.mediaFileId },
      },
      callerid_options: { callerid: params.callerId.replace(/\D/g, '') },
      schedule: {
        startingdate: formatInTimeZone(
          startingDate,
          SCHEDULE_TZ,
          CALLHUB_DATE_FORMAT,
        ),
        expirationdate: formatInTimeZone(
          expirationDate,
          SCHEDULE_TZ,
          CALLHUB_DATE_FORMAT,
        ),
        timezone: SCHEDULE_TZ,
        daily_start_time: DAILY_START_TIME,
        daily_stop_time: DAILY_STOP_TIME,
        monday: true,
        tuesday: true,
        wednesday: true,
        thursday: true,
        friday: true,
        saturday: true,
        sunday: true,
      },
      contact_options: {
        use_contact_tz: true,
        dont_call_dnc: true,
        dont_call_litigator: true,
        block_cellphone_numbers: true,
      },
    }

    // Parse OUTSIDE the fetch try/catch so a response-shape mismatch surfaces
    // as a schema error, not a retryable BadGatewayException the caller would
    // treat as a transient vendor failure.
    const data = await this.postCampaign(body)
    return {
      ...CreateVbCampaignResponseSchema.parse(data),
      startingDate,
      expirationDate,
      callsPerMinute: frequency,
    }
  }

  // Launches a PAUSED voice broadcast: PUT /v1/voice_broadcasts/{pk_str}/ with
  // status START (1), the transition that actually DIALS. Separate from create
  // by design — the money/compliance gates that guard a real dial live in the
  // caller, never here. A CallHub failure surfaces as 502 via the error-handling
  // wrapper; the response is parsed OUTSIDE the fetch try/catch so a shape
  // mismatch is a schema error, not a retryable vendor failure.
  async launchVoiceBroadcast(pkStr: string): Promise<LaunchVbCampaignResponse> {
    const data = await this.putStatus(pkStr)
    return LaunchVbCampaignResponseSchema.parse(data)
  }

  // ABORTs a PAUSED voice broadcast: PUT status ABORT (3), a terminal that
  // stops the campaign from ever dialing. The opposite of launch — it only ever
  // makes a campaign LESS likely to place calls — so the cleanup sweep uses it
  // to retire orphaned PAUSED campaigns. A 404 means the campaign is already gone
  // (deleted out-of-band, or a stale pk_str): it can never dial, so the orphan
  // is resolved — swallow it so the sweep stamps the row aborted instead of
  // retrying a genuinely-gone campaign against the rate-limited API forever. Any
  // other CallHub failure surfaces as 502 and the sweep retries next pass.
  async abortVoiceBroadcast(pkStr: string): Promise<void> {
    try {
      await this.http.put(`${LAUNCH_PATH_PREFIX}${pkStr}/`, {
        status: CALLHUB_VB_STATUS.ABORT,
      })
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 404) {
        this.logger.info(
          { pkStr },
          'CallHub abort: campaign already gone (404); treating as retired',
        )
        return
      }
      this.errorHandling.handleApiError({
        error,
        logger: this.logger,
        customMessage: 'CallHub voice broadcast abort failed',
      })
    }
  }

  private async postCampaign(body: CreateVbCampaignBody) {
    try {
      return await this.http.post(CREATE_PATH, body)
    } catch (error) {
      return this.errorHandling.handleApiError({
        error,
        logger: this.logger,
        customMessage: 'CallHub voice broadcast creation failed',
      })
    }
  }

  private async putStatus(pkStr: string) {
    try {
      return await this.http.put(`${LAUNCH_PATH_PREFIX}${pkStr}/`, {
        status: CALLHUB_VB_STATUS.START,
      })
    } catch (error) {
      return this.errorHandling.handleApiError({
        error,
        logger: this.logger,
        customMessage: 'CallHub voice broadcast launch failed',
      })
    }
  }
}
