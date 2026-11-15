import { Injectable } from '@nestjs/common'
import { AnalyticsService } from '@/analytics/analytics.service'
import {
  ContactUploadFailureKind,
  ContactUploadStatus,
} from '@/generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { EVENTS } from '@/vendors/segment/segment.types'

export const STUCK_FAILURE_REASON = "This upload didn't finish. Try again."

// An upload is `processing` only while its contactUploadProcess job is
// waiting, retrying or running: confirm and retry flip the status, send the
// job and record its id (`processJobId`) in one transaction. When pg-boss
// gives that job up without the worker's own failure path running (the last
// attempt lost to a crash, a missed heartbeat, the timeout or a shutdown),
// nothing else would ever move the upload. This marks those uploads failed,
// as the worker's last attempt does, so Try again is offered and email
// confirm stops waiting on them.
@Injectable()
export class ContactUploadStuckService extends createPrismaBase(
  MODELS.ContactUpload,
) {
  constructor(private readonly analytics: AnalyticsService) {
    super()
  }

  // Every organization when none is given. Starts from the uploads still
  // processing (status index; usually none), then reads only their jobs, by
  // pgboss.job's (name, id) primary key. Never scans the job table.
  async failStuck(organizationSlug?: string): Promise<number> {
    const processing = await this.model.findMany({
      where: {
        status: ContactUploadStatus.processing,
        ...(organizationSlug ? { organizationSlug } : {}),
        // An upload from before job ids were recorded can't be looked up,
        // so it is never taken for stuck.
        processJobId: { not: null },
      },
      select: {
        id: true,
        processJobId: true,
        userId: true,
        rowCount: true,
        organizationSlug: true,
      },
    })
    if (processing.length === 0) return 0
    const jobIds = processing.flatMap((upload) =>
      upload.processJobId ? [upload.processJobId] : [],
    )
    const live = await this.client.$queryRaw<Array<{ id: string }>>`
      SELECT id::text AS id FROM pgboss.job
      WHERE name = 'contactUploadProcess'
        AND id = ANY(${jobIds}::uuid[])
        AND state IN ('created', 'retry', 'active')
    `
    const liveIds = new Set(live.map((job) => job.id))
    let failed = 0
    for (const upload of processing) {
      if (upload.processJobId && liveIds.has(upload.processJobId)) continue
      // Still the job it was sent with: a retry in between would have sent a
      // new one, and the worker finishing moves the status.
      const { count } = await this.model.updateMany({
        where: {
          id: upload.id,
          status: ContactUploadStatus.processing,
          processJobId: upload.processJobId,
        },
        data: {
          status: ContactUploadStatus.failed,
          failureReason: STUCK_FAILURE_REASON,
          failureKind: ContactUploadFailureKind.transient,
        },
      })
      if (count === 0) continue
      failed += 1
      this.logger.warn(
        { uploadId: upload.id },
        'contact upload had no live job; marked failed',
      )
      if (upload.userId === null) continue
      void this.analytics
        .track(upload.userId, EVENTS.Contacts.ImportFailed, {
          uploadId: upload.id,
          failureKind: ContactUploadFailureKind.transient,
          rowCount: upload.rowCount,
          product: upload.organizationSlug.startsWith('eo-') ? 'serve' : 'win',
        })
        .catch(() => undefined)
    }
    return failed
  }
}
