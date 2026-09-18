import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { subDays } from 'date-fns'
import { PinoLogger } from 'nestjs-pino'
import { CronLockService } from '@/cron/services/cronLock.service'
import { PrismaService } from '@/prisma/prisma.service'
import { EASTERN_TIMEZONE } from '@/shared/util/date.util'
import { OutreachStatus } from '../../generated/prisma'
import { OutreachDraftService } from './outreachDraft.service'

// The other outreach robocall crons, together, already claim every minute
// of every hour (cleanup :00/:10/.../:50, deferred-cancel :01/:16/:31/:46,
// capture :02/:12/.../:52, hold-reconcile :03/:13/.../:53, send
// :04/:14/.../:54, fresh-charge :05/:15/.../:55, stranded :06/:21/:36/:51,
// staging :07/:17/.../:57, hold-recovery :08/:18/.../:58, completion
// :09/:19/.../:59, cancel :11/:26/:41/:56) — so there is no minute this daily
// job can land on without sharing one with some hourly sweep; :37 lands on
// staging's. That overlap is harmless: each is its own `@Cron` name with its
// own `cron_run` lock row (CronLockService keys on jobName+runDate, not on
// the minute), this job is a single Postgres scan with no vendor call, and
// staging already survives running alongside every other minute's sweep on
// every other hour of the day.
const EXPIRY_CRON = '37 4 * * *'
const EXPIRY_JOB = 'outreachDraftExpiry'
export const DRAFT_RETENTION_DAYS = 90

// A candidate who cannot send yet may still build and abandon several
// drafts; this bounds how long an abandoned draft (and its S3 image/audio)
// sits around unused.
@Injectable()
export class OutreachDraftExpiryService {
  constructor(
    private readonly drafts: OutreachDraftService,
    private readonly cronLock: CronLockService,
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OutreachDraftExpiryService.name)
  }

  // Runs in every environment: it spends no money and hits no vendor, and a
  // dev-only draft pile-up is exactly what it exists to prevent.
  @Cron(EXPIRY_CRON, { name: EXPIRY_JOB, timeZone: EASTERN_TIMEZONE })
  async expireDrafts(): Promise<void> {
    const now = new Date()
    if (!(await this.cronLock.tryClaimDailyRun(EXPIRY_JOB, now))) return
    try {
      const cutoff = subDays(now, DRAFT_RETENTION_DAYS)
      const rows = await this.prisma.outreach.findMany({
        where: { status: OutreachStatus.draft, createdAt: { lt: cutoff } },
        include: { robocall: true },
      })
      for (const row of rows) {
        try {
          await this.drafts.deleteDraftRow(row)
          this.logger.info(
            { outreachId: row.id, outreachType: row.outreachType },
            'outreach draft expired',
          )
        } catch (err) {
          this.logger.error(
            { err, outreachId: row.id },
            'draft expiry failed; continuing',
          )
        }
      }
    } finally {
      await this.cronLock.markCompleted(EXPIRY_JOB, now)
    }
  }
}
