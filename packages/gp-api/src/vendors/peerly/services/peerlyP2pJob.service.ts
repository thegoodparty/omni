import {
  BadGatewayException,
  BadRequestException,
  Injectable,
} from '@nestjs/common'
import { isAxiosError } from 'axios'
import { formatISO } from 'date-fns'
import { Headers } from 'http-constants-ts'
import { Readable } from 'stream'
import { PinoLogger } from 'nestjs-pino'
import { P2P_SCRIPT_MAX_LENGTH } from '@goodparty_org/contracts'
import {
  P2P_ERROR_MESSAGES,
  P2P_JOB_DEFAULTS,
} from '../constants/p2pJob.constants'
import { PeerlyBaseConfig } from '../config/peerlyBaseConfig'
import { PeerlyErrorHandlingService } from './peerlyErrorHandling.service'
import { PeerlyHttpService } from './peerlyHttp.service'
import { PeerlyMediaService } from './peerlyMedia.service'
import { PeerlyScheduleService } from './peerlySchedule.service'
import {
  CreateJobResponseDto,
  GetJobResponseDto,
  JobDetailedStatsResponseDto,
} from '../schemas/peerlyP2pSms.schema'
import { CreateJobParams, PeerlyJob } from '../peerly.types'

interface CreateP2pJobParams {
  campaignId: number
  listId: number
  imageInfo: {
    fileStream: Readable | Buffer
    fileName: string
    mimeType: string
    fileSize?: number
    title?: string
  }
  scriptText: string
  identityId: string
  name?: string
  didState?: string
  didNpaSubset?: string[]
  scheduledDate?: string
}

interface UpdateP2pJobParams {
  jobId: string
  campaignId: number
  imageInfo: CreateP2pJobParams['imageInfo']
  scriptText: string
  identityId: string
  name?: string
  // Set only when the send date changed: Peerly has no schedule-update
  // endpoint, so a reschedule mints a fresh schedule and repoints the job's
  // schedule_id + start/end dates at it. Omitted, the job keeps its schedule.
  rescheduleDate?: string
}

@Injectable()
export class PeerlyP2pJobService extends PeerlyBaseConfig {
  constructor(
    protected readonly logger: PinoLogger,
    private readonly peerlyMediaService: PeerlyMediaService,
    private readonly peerlyScheduleService: PeerlyScheduleService,
    private readonly peerlyHttpService: PeerlyHttpService,
    private readonly peerlyErrorHandling: PeerlyErrorHandlingService,
  ) {
    super(logger)
  }

  async createPeerlyP2pJob({
    campaignId,
    listId,
    imageInfo,
    scriptText,
    identityId,
    name = P2P_JOB_DEFAULTS.CAMPAIGN_NAME,
    didState = P2P_JOB_DEFAULTS.DID_STATE,
    didNpaSubset = [],
    scheduledDate,
  }: CreateP2pJobParams): Promise<string> {
    // Peerly returns a 400 for oversized MMS template text; reject before
    // creating media and a schedule that would be orphaned by that failure.
    if (scriptText.length > P2P_SCRIPT_MAX_LENGTH) {
      throw new BadRequestException(P2P_ERROR_MESSAGES.SCRIPT_TOO_LONG)
    }

    let jobId: string | undefined
    let scheduleId: number | undefined

    try {
      this.logger.info('Creating media for P2P job')
      const mediaId = await this.peerlyMediaService.createMedia({
        identityId,
        fileStream: imageInfo.fileStream,
        fileName: imageInfo.fileName,
        mimeType: imageInfo.mimeType,
        fileSize: imageInfo.fileSize,
        title: imageInfo.title,
      })
      this.logger.info(`Media created with ID: ${mediaId}`)

      // extract date portion directly from ISO string to preserve the user's intended date
      const dateOnly = scheduledDate?.slice(0, 10)

      const targetDate = dateOnly || 'no-date'
      const createdAt = formatISO(new Date())
      const scheduleName = `GP P2P - Campaign ${campaignId} - ${targetDate} - ${createdAt}`
      scheduleId = await this.peerlyScheduleService.createSchedule(scheduleName)

      this.logger.info('Creating P2P job')
      jobId = await this.createJob({
        name,
        templates: [
          {
            is_default: true,
            title: P2P_JOB_DEFAULTS.TEMPLATE_TITLE,
            text: scriptText,
            media: {
              media_type: 'IMAGE',
              media_id: mediaId,
              title: imageInfo.title || P2P_JOB_DEFAULTS.TEMPLATE_TITLE,
            },
          },
        ],
        didState,
        didNpaSubset,
        identityId,
        scheduledDate: dateOnly,
        scheduleId,
      })
      this.logger.info(`Job created with ID: ${jobId}`)

      this.logger.info(`Assigning list ${listId} to job ${jobId}`)
      await this.assignListToJob(jobId, listId, { campaignId, scheduleId })
      this.logger.info('List assigned successfully')

      this.logger.info(
        `P2P job creation completed successfully for campaign ${campaignId}`,
      )

      return jobId
    } catch (error) {
      // A BadRequestException carries a user-fixable Peerly content
      // rejection (peerlyErrorHandling.service.ts) — don't bury it under
      // the generic 502.
      if (error instanceof BadRequestException) {
        throw error
      }
      const isListAssignmentFailure =
        error instanceof BadGatewayException &&
        error.message.includes(P2P_ERROR_MESSAGES.LIST_ASSIGNMENT_FAILED)
      if (isListAssignmentFailure) {
        throw error
      }
      this.logger.error(
        { error, scheduleId },
        P2P_ERROR_MESSAGES.JOB_CREATION_FAILED,
      )
      throw new BadGatewayException(P2P_ERROR_MESSAGES.JOB_CREATION_FAILED)
    }
  }

  // Edit-before-send. Templates are a destructive full-array overwrite on
  // Peerly's side, so the caller always sends the complete script + image —
  // media is re-created per edit (same orphan posture as a failed create).
  async updatePeerlyP2pJob({
    jobId,
    campaignId,
    imageInfo,
    scriptText,
    identityId,
    name,
    rescheduleDate,
  }: UpdateP2pJobParams): Promise<void> {
    if (scriptText.length > P2P_SCRIPT_MAX_LENGTH) {
      throw new BadRequestException(P2P_ERROR_MESSAGES.SCRIPT_TOO_LONG)
    }

    try {
      const mediaId = await this.peerlyMediaService.createMedia({
        identityId,
        fileStream: imageInfo.fileStream,
        fileName: imageInfo.fileName,
        mimeType: imageInfo.mimeType,
        fileSize: imageInfo.fileSize,
        title: imageInfo.title,
      })

      let scheduleId: number | undefined
      if (rescheduleDate) {
        const scheduleName = `GP P2P - Campaign ${campaignId} - ${rescheduleDate} - ${formatISO(new Date())}`
        scheduleId =
          await this.peerlyScheduleService.createSchedule(scheduleName)
      }

      const body = {
        account_id: this.accountNumber,
        ...(name && { name }),
        templates: [
          {
            is_default: true,
            title: P2P_JOB_DEFAULTS.TEMPLATE_TITLE,
            text: scriptText,
            media: {
              media_type: 'IMAGE',
              media_id: mediaId,
              title: imageInfo.title || P2P_JOB_DEFAULTS.TEMPLATE_TITLE,
            },
          },
        ],
        can_use_mms: true,
        ...(scheduleId && {
          schedule_id: scheduleId,
          start_date: rescheduleDate,
          end_date: rescheduleDate,
        }),
      }

      this.logger.debug({ body }, `Updating Peerly job ${jobId} with body:`)
      try {
        await this.peerlyHttpService.put(`/1to1/jobs/${jobId}`, body)
      } catch (error) {
        // Same parse as createJob: a Peerly content rejection
        // (Errors.templates) surfaces as an actionable 400, not a blanket
        // 502 (ENG-10981).
        await this.peerlyErrorHandling.handleApiError({
          error,
          logger: this.logger,
        })
      }
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error
      }
      this.logger.error({ error }, P2P_ERROR_MESSAGES.JOB_UPDATE_FAILED)
      throw new BadGatewayException(P2P_ERROR_MESSAGES.JOB_UPDATE_FAILED)
    }
  }

  async getJobsByIdentityId(identityId: string): Promise<PeerlyJob[]> {
    try {
      this.logger.debug(`Getting P2P jobs list for ${identityId}`)
      const response = await this.peerlyHttpService.get<PeerlyJob[]>(
        `/1to1/jobs?account_id=${this.accountNumber}&identity_id=${identityId}`,
      )
      const { data: jobs } = response
      this.logger.debug({ jobs }, 'Fetched P2P Jobs:')
      return jobs
    } catch (error) {
      this.logger.error({ error }, P2P_ERROR_MESSAGES.RETRIEVE_JOBS_FAILED)
      throw new BadGatewayException(P2P_ERROR_MESSAGES.RETRIEVE_JOBS_FAILED)
    }
  }

  // Peerly has no DELETE verb for jobs: cancellation is a status write on
  // DELETE /1to1/jobs/{id} (204). The endpoint is documented but missing
  // from Peerly's llms.txt index
  // (https://api-docs.peerly.com/reference/delete-1to1-sms-job). See
  // scratch/voter-outreach/research/peerly-job-cancel.md.
  async deleteJob(jobId: string): Promise<void> {
    try {
      this.logger.debug(`Deleting P2P job ${jobId}`)
      await this.peerlyHttpService.delete(`/1to1/jobs/${jobId}`)
    } catch (error) {
      // Already-deleted is the desired state, not a failure: cancel retries
      // after a refund failure re-run this delete, and treating the 404 as
      // fatal would strand the row pending with the vendor job already gone.
      if (isAxiosError(error) && error.response?.status === 404) {
        this.logger.debug(`P2P job ${jobId} already deleted; treating as done`)
        return
      }
      this.logger.error({ error }, P2P_ERROR_MESSAGES.DELETE_JOB_FAILED)
      throw new BadGatewayException(P2P_ERROR_MESSAGES.DELETE_JOB_FAILED)
    }
  }

  // The send trigger: books Peerly's paid canvassers for the job. Their
  // team reviews the request; approval lands on the job as
  // canvassers_schedule.approved. One open request per job — reschedules
  // must clearCanvassers first.
  async requestCanvassers(
    jobId: string,
    { date }: { date?: string } = {},
  ): Promise<void> {
    try {
      // Peerly validates requested_initials against the REQUESTING user —
      // the API login this service authenticates as — not the human who
      // clicked approve (whose initials it 400s as "invalid user
      // initials"). So the initials are always derived from the
      // authenticated Peerly user, never taken from a caller.
      const user = await this.peerlyHttpService.getAuthenticatedUser()
      const initials =
        `${user.first_name.charAt(0)}${user.last_name.charAt(0)}`.toUpperCase()
      // The send window is a product requirement (2026-09-02): canvassers
      // work 9am-9pm in each recipient's local timezone. Sent explicitly as
      // a CUSTOM window rather than relying on the vendor's ANY_TIME
      // default semantics.
      await this.peerlyHttpService.post(`/v2/p2p/${jobId}/request_canvassers`, {
        requested_initials: initials,
        ...(date && { requested_date: date }),
        requested_timeframe: 'CUSTOM',
        requested_start_time: '09:00:00',
        requested_end_time: '21:00:00',
        requested_timezone: 'LOCAL',
      })
    } catch (error) {
      // A 400 here is CAS-actionable (e.g. a request already open) — keep
      // Peerly's own message via the shared parser instead of a blanket 502.
      await this.peerlyErrorHandling.handleApiError({
        error,
        logger: this.logger,
        context: {
          customMessage: P2P_ERROR_MESSAGES.REQUEST_CANVASSERS_FAILED,
        },
      })
    }
  }

  async clearCanvassers(jobId: string): Promise<void> {
    try {
      await this.peerlyHttpService.post(`/v2/p2p/${jobId}/clear_canvassers`)
    } catch (error) {
      // Nothing-to-clear is the desired state: a 404/400 for a job with no
      // open request must not fail the caller (edit clears defensively).
      if (
        isAxiosError(error) &&
        (error.response?.status === 404 || error.response?.status === 400)
      ) {
        this.logger.debug(
          `No canvasser request to clear on job ${jobId}; treating as done`,
        )
        return
      }
      this.logger.error({ error }, P2P_ERROR_MESSAGES.CLEAR_CANVASSERS_FAILED)
      throw new BadGatewayException(P2P_ERROR_MESSAGES.CLEAR_CANVASSERS_FAILED)
    }
  }

  async getJobDetailedStats(
    jobId: string,
    range?: { startDate: string; endDate: string },
  ): Promise<{
    sentTotal: number
    receivedTotal: number
    delivered: number
    deliveryFailed: number
    deliveryUnconfirmed: number
    totalCost: number
  }> {
    try {
      // date_range is required and Peerly scans the whole span server-side;
      // THIS_YEAR over a busy account stalls the read for minutes, so
      // callers that know the job's lifetime pass a CUSTOM window instead.
      const response = await this.peerlyHttpService.get(
        `/1to1/jobs/${jobId}/detailedstats`,
        {
          params: range
            ? {
                date_range: 'CUSTOM',
                start_date: range.startDate,
                end_date: range.endDate,
              }
            : { date_range: 'THIS_YEAR' },
        },
      )
      const stats = this.peerlyHttpService.validateResponse(
        response.data,
        JobDetailedStatsResponseDto,
        'job detailed stats',
      )
      // Key names inside the count maps aren't documented (docs say
      // "RX/TX SUCCESS/FAIL"), so counts sum by direction prefix.
      const sumBy = (
        record: Record<string, number> | undefined,
        prefix: string,
      ) =>
        Object.entries(record ?? {})
          .filter(([key]) => key.toUpperCase().startsWith(prefix))
          .reduce((total, [, count]) => total + count, 0)
      const receipts = {
        ...(stats.delivery_receipts ?? {}),
      }
      for (const [key, count] of Object.entries(
        stats.mms_delivery_receipts ?? {},
      )) {
        receipts[key] = (receipts[key] ?? 0) + count
      }
      return {
        sentTotal:
          sumBy(stats.messages, 'TX') + sumBy(stats.mms_messages, 'TX'),
        receivedTotal:
          sumBy(stats.messages, 'RX') + sumBy(stats.mms_messages, 'RX'),
        delivered: receipts['Delivered'] ?? 0,
        deliveryFailed: receipts['Delivery Failed'] ?? 0,
        deliveryUnconfirmed: receipts['Delivery Unconfirmed'] ?? 0,
        totalCost: stats.total_cost ?? 0,
      }
    } catch (error) {
      this.logger.error({ error }, P2P_ERROR_MESSAGES.JOB_STATS_FAILED)
      throw new BadGatewayException(P2P_ERROR_MESSAGES.JOB_STATS_FAILED)
    }
  }

  async getJob(jobId: string): Promise<PeerlyJob> {
    try {
      this.logger.debug(`Getting job ${jobId}`)
      const response = await this.peerlyHttpService.get<PeerlyJob>(
        `/1to1/jobs/${jobId}`,
      )
      const { data: job } = response
      // The schema is a deliberate subset of PeerlyJob (the sweep's fields),
      // so the validated result is merged over the raw job rather than
      // replacing it — callers keep the full shape, the guarded fields keep
      // the parsed values.
      const validated = this.peerlyHttpService.validateResponse(
        job,
        GetJobResponseDto,
        'get job',
      )
      this.logger.debug({ job }, 'Fetched P2P Job:')
      return { ...job, ...validated }
    } catch (error) {
      this.logger.error({ error }, P2P_ERROR_MESSAGES.RETRIEVE_JOB_FAILED)
      throw new BadGatewayException(P2P_ERROR_MESSAGES.RETRIEVE_JOB_FAILED)
    }
  }

  private async createJob({
    name,
    templates,
    didState,
    didNpaSubset = [],
    identityId,
    scheduledDate,
    scheduleId,
  }: CreateJobParams): Promise<string> {
    const hasMms = templates.some((t) => !!t.media)

    const body = {
      account_id: this.accountNumber,
      name,
      templates,
      did_state: didState,
      ...(didNpaSubset.length > 0 && { did_npa_subset: didNpaSubset }),
      can_use_mms: hasMms,
      schedule_id: scheduleId,
      ...(identityId && { identity_id: identityId }),
      ...(scheduledDate && {
        start_date: scheduledDate,
        end_date: scheduledDate,
      }),
    }

    try {
      this.logger.debug({ body }, 'Creating Peerly job with body:')
      const response = await this.peerlyHttpService.post('/1to1/jobs', body)

      const { data } = response
      const validated = this.peerlyHttpService.validateResponse(
        data,
        CreateJobResponseDto,
        'create job',
      )

      let jobId: string | undefined = validated.id || undefined

      if (!jobId) {
        const locationHeader = String(
          response.headers?.[Headers.LOCATION.toLowerCase()] ?? '',
        )
        if (locationHeader) {
          jobId = locationHeader.split('/').pop()
        }
      }

      if (!jobId) {
        this.logger.error(
          { headers: response.headers, data },
          'Job created but no job ID found in response',
        )
        throw new BadGatewayException(
          'Job creation succeeded but job ID not found in response body or headers.',
        )
      }

      this.logger.info(`Created job with ID: ${jobId}`)
      return jobId
    } catch (error) {
      return this.peerlyErrorHandling.handleApiError({
        error,
        logger: this.logger,
      })
    }
  }

  private async assignListToJob(
    jobId: string,
    listId: number,
    context?: { campaignId?: number; scheduleId?: number },
  ): Promise<void> {
    try {
      await this.peerlyHttpService.post(`/1to1/jobs/${jobId}/assignlist`, {
        list_id: listId,
      })
    } catch (error) {
      return this.peerlyErrorHandling.handleApiError({
        error,
        context: {
          customMessage: P2P_ERROR_MESSAGES.LIST_ASSIGNMENT_FAILED,
          recoveryInfo: {
            jobId,
            listId,
            ...(context?.campaignId != null && {
              campaignId: context.campaignId,
            }),
            ...(context?.scheduleId != null && {
              scheduleId: context.scheduleId,
            }),
          },
        },
        logger: this.logger,
      })
    }
  }
}
