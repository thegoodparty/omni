import { Injectable } from '@nestjs/common'
import { subHours } from 'date-fns'
import { ContactUploadStatus, Prisma } from '@/generated/prisma'
import type { JobRun, ScheduleData } from '@/jobs/jobs.registry'
import { JobsService } from '@/jobs/jobs.service'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import {
  CONTACT_UPLOAD_FILE_SELECT,
  ContactUploadFilesService,
} from './contactUploadFiles.service'

// The presigned PUT expires after 15 minutes, so an upload still waiting for
// its file a day later was abandoned in the browser.
const ABANDONED_AFTER_HOURS = 24
const ABANDONED_SWEEP_BATCH = 200

const abandonedWhere = (): Prisma.ContactUploadWhereInput => ({
  status: ContactUploadStatus.awaiting_file,
  createdAt: { lt: subHours(new Date(), ABANDONED_AFTER_HOURS) },
})

@Injectable()
export class ContactUploadAbandonedSweepService extends createPrismaBase(
  MODELS.ContactUpload,
) {
  constructor(
    private readonly jobs: JobsService,
    private readonly contactUploadFiles: ContactUploadFilesService,
  ) {
    super()
  }

  // The contactUploadAbandonedSweep schedule's worker
  // (src/jobs/jobs.registry.ts): one contactUploadAbandonedDelete job per
  // abandoned upload, oldest first.
  //
  // No deploy allowlist: every upload it touches is a row in this deploy's
  // own database, and its file key carries the upload's uuid, so a preview
  // sharing the dev bucket only ever deletes its own files.
  async fanOut(job: JobRun<ScheduleData>): Promise<void> {
    const abandoned = await this.model.findMany({
      where: abandonedWhere(),
      orderBy: { createdAt: Prisma.SortOrder.asc },
      take: ABANDONED_SWEEP_BATCH,
      select: { id: true },
    })
    await this.jobs.sendMany(
      'contactUploadAbandonedDelete',
      abandoned.map(({ id }) => ({
        data: { uploadId: id },
        key: `${id}:${job.id}`,
      })),
    )
    if (abandoned.length > 0) {
      this.logger.info(
        { found: abandoned.length },
        'Abandoned contact uploads queued for delete',
      )
    }
  }

  // The contactUploadAbandonedDelete job's worker. The file goes first: a
  // row deleted before its file would leave nothing to retry the file from.
  async deleteAbandoned(job: JobRun<{ uploadId: string }>): Promise<void> {
    const { uploadId } = job.data
    const upload = await this.model.findFirst({
      where: { id: uploadId, ...abandonedWhere() },
      select: { id: true, ...CONTACT_UPLOAD_FILE_SELECT },
    })
    if (!upload) return
    await this.contactUploadFiles.deleteFiles([upload])
    await this.model.deleteMany({
      where: { id: upload.id, status: ContactUploadStatus.awaiting_file },
    })
  }
}
