import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { subHours } from 'date-fns'
import { PinoLogger } from 'nestjs-pino'
import { EASTERN_TIMEZONE } from '@/shared/util/date.util'
import { setSesAccountReputation } from '../util/sesReputation.metrics'
import { SesService } from './ses.service'

const REPORT_JOB = 'sesReputationReport'
const REPORT_CRON = '3-59/5 * * * *'
// SES publishes the reputation metrics only every so often. Three hours is
// the window the CloudWatch-backed rules read.
const LOOKBACK_HOURS = 3

@Injectable()
export class SesReputationReportService {
  constructor(
    private readonly ses: SesService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(SesReputationReportService.name)
  }

  // Every task runs this, with no CronLockService claim, on purpose. The
  // gauge is exported per task (service.instance.id), so a task that skipped
  // the read would keep exporting an older reading and `max()` in the rule
  // would page on it. The read changes nothing, so running it N times is
  // only N GetMetricData calls.
  //
  // Prod only, as an alerting job: the rules exist only in prod, and dev
  // shares the account, so a dev series would be the same numbers again.
  @Cron(REPORT_CRON, { name: REPORT_JOB, timeZone: EASTERN_TIMEZONE })
  async report(): Promise<void> {
    if (process.env.OTEL_SERVICE_ENVIRONMENT !== 'prod') return

    const now = new Date()
    try {
      setSesAccountReputation(
        await this.ses.getAccountReputation(subHours(now, LOOKBACK_HOURS), now),
      )
    } catch (err) {
      // The last reading stays exported, as the old rules' KeepLast did on a
      // query error; a reading nobody took is not a reason to resolve.
      this.logger.warn({ err }, 'Reading SES account reputation failed')
    }
  }
}
