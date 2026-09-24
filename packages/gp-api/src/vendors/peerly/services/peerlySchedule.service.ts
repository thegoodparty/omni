import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { P2P_SCHEDULE_DEFAULTS } from '../constants/p2pJob.constants'
import { PeerlyBaseConfig } from '../config/peerlyBaseConfig'
import { PeerlyErrorHandlingService } from './peerlyErrorHandling.service'
import { PeerlyHttpService } from './peerlyHttp.service'
import { CreateScheduleResponseDto } from '../schemas/peerlySchedule.schema'
import { SEND_WINDOW_END } from '../utils/sendWindowStart.util'

const SCHEDULE_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

@Injectable()
export class PeerlyScheduleService extends PeerlyBaseConfig {
  constructor(
    protected readonly logger: PinoLogger,
    private readonly peerlyHttpService: PeerlyHttpService,
    private readonly peerlyErrorHandling: PeerlyErrorHandlingService,
  ) {
    super(logger)
  }

  // `startTime` is the resolved "HH:mm" window open (sendWindowStart.util);
  // the schedule is what Peerly's console shows as the job's hours, so it
  // must agree with the canvasser request or CAS reads a 9am send.
  async createSchedule(
    scheduleName: string,
    startTime: string,
  ): Promise<number> {
    const body = this.buildScheduleBody(scheduleName, startTime)

    try {
      this.logger.info(`Creating Peerly schedule: ${scheduleName}`)
      const response = await this.peerlyHttpService.post('/schedule', body)

      const { data } = response
      const validated = this.peerlyHttpService.validateResponse(
        data,
        CreateScheduleResponseDto,
        'create schedule',
      )

      const scheduleId = validated.Data.schedule_id
      this.logger.info(`Schedule created with ID: ${scheduleId}`)
      return scheduleId
    } catch (error) {
      return this.peerlyErrorHandling.handleApiError({
        error,
        logger: this.logger,
      })
    }
  }

  private buildScheduleBody(scheduleName: string, startTime: string) {
    const dayFields = Object.fromEntries(
      SCHEDULE_DAYS.flatMap((day) => [
        [`${day}_start`, `${startTime}:00`],
        [`${day}_end`, `${SEND_WINDOW_END}:00`],
      ]),
    )

    return {
      schedule_name: scheduleName,
      account: this.accountNumber,
      schedule_timezone: P2P_SCHEDULE_DEFAULTS.TIMEZONE,
      is_global: P2P_SCHEDULE_DEFAULTS.IS_GLOBAL,
      ...dayFields,
    }
  }
}
