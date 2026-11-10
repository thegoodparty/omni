import { Injectable } from '@nestjs/common'
import { AnalyticsService } from '@/analytics/analytics.service'
import { Prisma } from '@/generated/prisma'
import { createPrismaBase, MODELS } from '@/prisma/util/prisma.util'
import { EVENTS } from '@/vendors/segment/segment.types'

export const STUCK_FAILURE_REASON = "This upload didn't finish. Try again."

type FailedRow = {
  id: string
  userId: number | null
  rowCount: number | null
  organizationSlug: string
}

// An upload is `processing` only while a contactUploadProcess job for it is
// waiting, retrying or running: confirm and retry flip the status and send
// the job in one transaction. When pg-boss gives that job up without the
// worker's own failure path running (the last attempt lost to a crash, a
// missed heartbeat, the timeout or a shutdown), nothing else would ever move
// the upload. This marks those uploads failed, as the worker's last attempt
// does, so Try again is offered and nothing waits on them.
@Injectable()
export class ContactUploadStuckService extends createPrismaBase(
  MODELS.ContactUpload,
) {
  constructor(private readonly analytics: AnalyticsService) {
    super()
  }

  // One statement, so a retry that commits its status and job together is
  // seen whole or not at all. Every organization when none is given.
  async failStuck(organizationSlug?: string): Promise<number> {
    const scope = organizationSlug
      ? Prisma.sql`AND u.organization_slug = ${organizationSlug}`
      : Prisma.empty
    const failed = await this.client.$queryRaw<FailedRow[]>`
      UPDATE contact_upload u
      SET status = 'failed',
        failure_reason = ${STUCK_FAILURE_REASON},
        failure_kind = 'transient',
        updated_at = now()
      WHERE u.status = 'processing'
        ${scope}
        AND NOT EXISTS (
          SELECT 1 FROM pgboss.job j
          WHERE j.name = 'contactUploadProcess'
            AND j.data->>'uploadId' = u.id
            AND j.state IN ('created', 'retry', 'active')
        )
      RETURNING u.id, u.user_id AS "userId", u.row_count AS "rowCount",
        u.organization_slug AS "organizationSlug"
    `
    for (const upload of failed) {
      this.logger.warn(
        { uploadId: upload.id },
        'contact upload had no live job; marked failed',
      )
      if (upload.userId === null) continue
      void this.analytics
        .track(upload.userId, EVENTS.Contacts.ImportFailed, {
          uploadId: upload.id,
          failureKind: 'transient',
          rowCount: upload.rowCount,
          product: upload.organizationSlug.startsWith('eo-') ? 'serve' : 'win',
        })
        .catch(() => undefined)
    }
    return failed.length
  }
}
