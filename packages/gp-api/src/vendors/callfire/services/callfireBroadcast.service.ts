import { BadRequestException, Injectable } from '@nestjs/common'
import { addDays, isAfter } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import { PinoLogger } from 'nestjs-pino'
import { RobocallBroadcastStatus } from '@/outreach/vendor/robocallVendor.types'
import {
  BatchRequest,
  CALLFIRE_ANSWERING_MACHINE_CONFIG,
  CallBroadcastSchema,
  CreateBroadcastBody,
  mapCallfireBroadcastStatus,
  ResourceIdSchema,
} from '../schemas/callfireBroadcast.schema'
import { CallfireErrorHandlingService } from './callfireErrorHandling.service'
import { CallfireHttpService } from './callfireHttp.service'

const BROADCASTS_PATH = '/calls/broadcasts'
// use_contact_tz-equivalent: localTimeRestriction applies the daily window in
// each recipient's own tz, but the Schedule date range needs a fallback tz.
// Central keeps that window inside legal US calling hours; UTC would fire it
// at ~1am-1pm Eastern (a TCPA violation).
const SCHEDULE_TZ = 'America/Chicago'
// How long after the start the broadcast may keep dialing before it expires.
const EXPIRATION_WINDOW_DAYS = 7
// Per-recipient daily calling window (in local time). A 9am floor is stricter
// than the 8am legal floor; 9pm ceiling.
const DAILY_START = { hour: 9, minute: 0 }
const DAILY_STOP = { hour: 21, minute: 0 }
const DAYS_OF_WEEK = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
]
// No automatic re-dials — a robocall bills per call placed, so retries would
// multiply the charge. A later slice can widen this if the product wants it.
const DEFAULT_RETRY = {
  maxAttempts: 1,
  minutesBetweenAttempts: 60,
  retryResults: [],
}

interface CreateBroadcastParams {
  name: string
  // The rented caller-ID number the calls display.
  fromNumber: string
  // The pre-uploaded audio sound ids (CallFire media). Live plays to a human;
  // machine to an answering machine.
  liveSoundId: number
  machineSoundId?: number
  // The validated contact list to dial (CallfireContactsService.listId). Passed
  // as the string handle; attached to the broadcast via the batches endpoint.
  contactListId?: string
  // When dialing may start. Must be in the future: a create is always
  // scheduled, never immediate, so no call is placed at create time.
  scheduledStart: Date
  // Overrides the machine/live routing default.
  answeringMachineConfig?: string
}

export interface CreateBroadcastResult {
  // Opaque handle to the created (non-dialing) broadcast; launch / abort /
  // status address it. A string — CallFire ids are never used for arithmetic.
  campaignRef: string
  startingDate: Date
  expirationDate: Date
}

// Creates a CallFire voice broadcast in a scheduled, NON-DIALING (SETUP) state,
// then attaches the validated contact list. Launching — the POST
// /calls/broadcasts/{id}/start transition that actually DIALS — is a separate
// method the money / compliance gates in the caller drive, never create.
@Injectable()
export class CallfireBroadcastService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly http: CallfireHttpService,
    private readonly errorHandling: CallfireErrorHandlingService,
  ) {
    this.logger.setContext(CallfireBroadcastService.name)
  }

  async createBroadcast(
    params: CreateBroadcastParams,
  ): Promise<CreateBroadcastResult> {
    if (!isAfter(params.scheduledStart, new Date())) {
      throw new BadRequestException(
        'Voice broadcast must be scheduled in the future',
      )
    }

    const startingDate = params.scheduledStart
    const expirationDate = addDays(startingDate, EXPIRATION_WINDOW_DAYS)
    const machineConfig =
      params.answeringMachineConfig ??
      (params.machineSoundId !== undefined
        ? CALLFIRE_ANSWERING_MACHINE_CONFIG.AM_AND_LIVE
        : CALLFIRE_ANSWERING_MACHINE_CONFIG.LIVE_IMMEDIATE)

    const body: CreateBroadcastBody = {
      name: params.name,
      fromNumber: params.fromNumber.replace(/\D/g, ''),
      sounds: {
        liveSoundId: params.liveSoundId,
        machineSoundId: params.machineSoundId,
      },
      answeringMachineConfig: machineConfig,
      localTimeRestriction: {
        enabled: true,
        beginHour: DAILY_START.hour,
        beginMinute: DAILY_START.minute,
        endHour: DAILY_STOP.hour,
        endMinute: DAILY_STOP.minute,
      },
      retryConfig: DEFAULT_RETRY,
      schedules: [
        {
          startDate: this.toLocalDate(startingDate),
          stopDate: this.toLocalDate(expirationDate),
          startTimeOfDay: DAILY_START,
          stopTimeOfDay: DAILY_STOP,
          daysOfWeek: DAYS_OF_WEEK,
          timeZone: SCHEDULE_TZ,
        },
      ],
    }

    // ?start=false is load-bearing: it creates the broadcast WITHOUT dialing.
    // Parse OUTSIDE the fetch try/catch so a shape mismatch is a permanent
    // ZodError, not the retryable BadGatewayException a caller treats as a
    // transient vendor blip.
    const created = await this.postBroadcast(body)
    const { id } = ResourceIdSchema.parse(created)
    const campaignRef = String(id)

    if (params.contactListId) {
      try {
        await this.attachContactList(
          campaignRef,
          params.name,
          params.contactListId,
        )
      } catch (error) {
        // The broadcast already exists at CallFire; a failed attach would
        // otherwise orphan it (no audience, no persisted ref for any sweep to
        // reclaim, and every staging retry would create ANOTHER). Best-effort
        // stop it so it can never dial, then rethrow the ORIGINAL failure so
        // the caller reverts the row to authorized and retries cleanly.
        this.logger.error(
          { err: error, campaignRef },
          'CallFire contact-list attach failed; aborting orphaned broadcast',
        )
        try {
          await this.abortBroadcast(campaignRef)
        } catch (abortError) {
          this.logger.error(
            { err: abortError, campaignRef },
            'Failed to abort orphaned CallFire broadcast after attach failure',
          )
        }
        throw error
      }
    }

    return { campaignRef, startingDate, expirationDate }
  }

  // Launches a NON-DIALING broadcast: POST /calls/broadcasts/{id}/start — the
  // transition that actually DIALS. Separate from create by design; the money
  // and compliance gates that guard a real dial live in the caller, never here.
  async launchBroadcast(campaignRef: string): Promise<void> {
    try {
      await this.http.post(`${BROADCASTS_PATH}/${campaignRef}/start`)
    } catch (error) {
      this.errorHandling.handleApiError({
        error,
        logger: this.logger,
        customMessage: 'CallFire voice broadcast launch failed',
      })
    }
  }

  // Stops a broadcast: POST /calls/broadcasts/{id}/stop — the opposite of
  // launch, so it can only ever make a broadcast LESS likely to dial. Used to
  // retire an orphaned broadcast.
  async abortBroadcast(campaignRef: string): Promise<void> {
    try {
      await this.http.post(`${BROADCASTS_PATH}/${campaignRef}/stop`)
    } catch (error) {
      this.errorHandling.handleApiError({
        error,
        logger: this.logger,
        customMessage: 'CallFire voice broadcast abort failed',
      })
    }
  }

  // Reads the broadcast and maps CallFire's native lifecycle status to the
  // vendor-neutral enum the send/completion state machines switch on. Parsed
  // OUTSIDE the fetch try/catch (schema error vs retryable vendor failure).
  async getBroadcastStatus(
    campaignRef: string,
  ): Promise<RobocallBroadcastStatus> {
    const data = await this.fetchBroadcast(campaignRef)
    const broadcast = CallBroadcastSchema.parse(data)
    return mapCallfireBroadcastStatus(broadcast.status)
  }

  private async attachContactList(
    campaignRef: string,
    name: string,
    contactListId: string,
  ): Promise<void> {
    const batch: BatchRequest = {
      name,
      // The contact list handle is a numeric id on the wire even though we
      // carry it as a string everywhere else.
      contactListId: Number(contactListId),
    }
    try {
      await this.http.post(`${BROADCASTS_PATH}/${campaignRef}/batches`, batch)
    } catch (error) {
      this.errorHandling.handleApiError({
        error,
        logger: this.logger,
        customMessage: 'CallFire broadcast contact-list attach failed',
      })
    }
  }

  private toLocalDate(date: Date): {
    year: number
    month: number
    day: number
  } {
    return {
      year: Number(formatInTimeZone(date, SCHEDULE_TZ, 'yyyy')),
      month: Number(formatInTimeZone(date, SCHEDULE_TZ, 'M')),
      day: Number(formatInTimeZone(date, SCHEDULE_TZ, 'd')),
    }
  }

  private async postBroadcast(body: CreateBroadcastBody) {
    try {
      return await this.http.post(BROADCASTS_PATH, body, {
        params: { start: false },
      })
    } catch (error) {
      return this.errorHandling.handleApiError({
        error,
        logger: this.logger,
        customMessage: 'CallFire voice broadcast creation failed',
      })
    }
  }

  private async fetchBroadcast(campaignRef: string) {
    try {
      return await this.http.get(`${BROADCASTS_PATH}/${campaignRef}`)
    } catch (error) {
      return this.errorHandling.handleApiError({
        error,
        logger: this.logger,
        customMessage: 'CallFire voice broadcast status lookup failed',
      })
    }
  }
}
