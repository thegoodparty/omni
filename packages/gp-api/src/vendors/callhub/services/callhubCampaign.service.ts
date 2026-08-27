import { BadRequestException, Injectable } from '@nestjs/common'
import { addDays, isAfter } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import { PinoLogger } from 'nestjs-pino'
import {
  CreateVbCampaignBody,
  CreateVbCampaignResponse,
  CreateVbCampaignResponseSchema,
} from '../schemas/callhubCampaign.schema'
import { CallhubErrorHandlingService } from './callhubErrorHandling.service'
import { CallhubHttpService } from './callhubHttp.service'

// Trailing slash is load-bearing: POST /v1/vb_campaign (no slash) returns the
// campaign list instead of creating one.
const CREATE_PATH = '/v1/vb_campaign/'
const SCHEDULE_TZ = 'UTC'
const CALLHUB_DATE_FORMAT = 'yyyy-MM-dd HH:mm:ss'
// How long after the start the broadcast may keep dialing before it expires —
// enough for a large landline list to drain.
const EXPIRATION_WINDOW_DAYS = 7
// Per-contact calling window (via use_contact_tz). A 9am floor is stricter than
// the 8am legal floor.
const DAILY_START_TIME = '09:00'
const DAILY_STOP_TIME = '21:00'

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

  async createVoiceBroadcast(
    params: CreateVoiceBroadcastParams,
  ): Promise<CreateVbCampaignResponse> {
    if (!isAfter(params.scheduledStart, new Date())) {
      throw new BadRequestException(
        'Voice broadcast must be scheduled in the future',
      )
    }

    const body: CreateVbCampaignBody = {
      name: params.name,
      phonebooks: [params.phonebookPkStr],
      script: {
        label: params.name,
        live_message: { audiofile: params.mediaFileId },
      },
      callerid_options: { callerid: params.callerId.replace(/\D/g, '') },
      schedule: {
        startingdate: formatInTimeZone(
          params.scheduledStart,
          SCHEDULE_TZ,
          CALLHUB_DATE_FORMAT,
        ),
        expirationdate: formatInTimeZone(
          addDays(params.scheduledStart, EXPIRATION_WINDOW_DAYS),
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

    try {
      const data = await this.http.post(CREATE_PATH, body)
      return CreateVbCampaignResponseSchema.parse(data)
    } catch (error) {
      return this.errorHandling.handleApiError({
        error,
        logger: this.logger,
        customMessage: 'CallHub voice broadcast creation failed',
      })
    }
  }
}
