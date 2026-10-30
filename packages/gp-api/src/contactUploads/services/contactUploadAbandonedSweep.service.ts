import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { subHours } from 'date-fns'
import { ContactUploadStatus, Prisma } from '@/generated/prisma'
import { CronLockService } from '@/cron/services/cronLock.service'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { EASTERN_TIMEZONE } from '@/shared/util/date.util'
import {
  CONTACT_UPLOAD_FILE_SELECT,
  ContactUploadFilesService,
} from './contactUploadFiles.service'

const SWEEP_JOB = 'contactUploadAbandonedSweep'

// The presigned PUT expires after 15 minutes, so an upload still waiting for
// its file a day later was abandoned in the browser.
const ABANDONED_AFTER_HOURS = 24
const ABANDONED_SWEEP_BATCH = 200

@Injectable()
export class ContactUploadAbandonedSweepService extends createPrismaBase(
  MODELS.ContactUpload,
) {
  constructor(
    private readonly cronLock: CronLockService,
    private readonly contactUploadFiles: ContactUploadFilesService,
  ) {
    super()
  }

  // No deploy allowlist: every upload it touches is a row in this deploy's
  // own database, and its file key carries the upload's uuid, so a preview
  // sharing the dev bucket only ever deletes its own files.
  @Cron('43 * * * *', { name: SWEEP_JOB, timeZone: EASTERN_TIMEZONE })
  async sweepAbandonedUploads(): Promise<void> {
    await this.sweep(new Date())
  }

  async sweep(now: Date): Promise<void> {
    if (!(await this.cronLock.tryClaimHourlyRun(SWEEP_JOB, now))) return

    try {
      const abandoned = await this.model.findMany({
        where: {
          status: ContactUploadStatus.awaiting_file,
          createdAt: { lt: subHours(now, ABANDONED_AFTER_HOURS) },
        },
        orderBy: { createdAt: Prisma.SortOrder.asc },
        take: ABANDONED_SWEEP_BATCH,
        select: { id: true, ...CONTACT_UPLOAD_FILE_SELECT },
      })
      let deleted = 0
      let failed = 0
      // The file goes first: a row deleted before its file would leave
      // nothing to retry the file from.
      for (const upload of abandoned) {
        try {
          await this.contactUploadFiles.deleteFiles([upload])
        } catch (err) {
          this.logger.error(
            { err, uploadId: upload.id },
            'Abandoned contact upload file delete failed; kept for next run',
          )
          failed++
          continue
        }
        const { count } = await this.model.deleteMany({
          where: { id: upload.id, status: ContactUploadStatus.awaiting_file },
        })
        deleted += count
      }
      if (abandoned.length > 0) {
        this.logger.info(
          { found: abandoned.length, deleted, failed },
          'Abandoned contact upload sweep complete',
        )
      }
    } finally {
      await this.cronLock.markHourlyCompleted(SWEEP_JOB, now)
    }
  }
}
