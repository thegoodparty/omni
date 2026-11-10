import type { ContactUpload } from '@goodparty_org/contracts'
import {
  UPLOAD_HISTORY_PATH,
  uploadDetailPath,
} from 'app/dashboard/contacts/crm/import/importContactsCopy'
import type { EmailSurface } from './emailSurface'

export type ImportStatusLink = { text: string; href: string }

export type EmailImportStatus = {
  // An upload is still being matched, so the count and price can still
  // change: gp-api refuses confirm until it is done.
  importing: boolean
  // The line, then a link to the upload (or Import history), then the rest.
  line: string | null
  link: ImportStatusLink | null
  after: string | null
}

const NONE: EmailImportStatus = {
  importing: false,
  line: null,
  link: null,
  after: null,
}

// The rows waiting on a choice: their upload's page, or Import history when
// more than one upload has some.
const waitingOn = (
  uploads: ContactUpload[],
  needsInput: (upload: ContactUpload) => number,
): { count: number; href: string } | null => {
  const waiting = uploads.filter((upload) => needsInput(upload) > 0)
  const [only] = waiting
  if (!only) return null
  return {
    count: waiting.reduce((sum, upload) => sum + needsInput(upload), 0),
    href:
      waiting.length === 1 ? uploadDetailPath(only.id) : UPLOAD_HISTORY_PATH,
  }
}

const joined = (parts: (string | null)[]): string | null =>
  parts.filter(Boolean).join(' ') || null

// Every upload still processing counts, wherever it was started, since each
// one holds the send. Once none is, only the one imported in this flow has a
// line, saying how it ended. One gp-api failed because its job was lost
// reads as failed too, so it ends here the same way.
export const emailImportStatus = (
  uploads: ContactUpload[],
  flowUploadId: string | null,
  surface: EmailSurface,
  onReviewStep: boolean,
): EmailImportStatus => {
  const copy = surface.importStatus
  const processing = uploads.filter((upload) => upload.status === 'processing')
  const mine = uploads.find((upload) => upload.id === flowUploadId)
  const waiting =
    processing.length > 0
      ? waitingOn(processing, (upload) => upload.progress?.needsInput ?? 0)
      : mine?.status === 'needs_input'
        ? waitingOn([mine], (upload) => upload.needsInputCount)
        : null
  const review = waiting && {
    link: { text: copy.needReview(waiting.count), href: waiting.href },
    after: copy.leftOut(waiting.count),
  }
  if (processing.length > 0) {
    const added = processing.reduce(
      (sum, upload) => sum + (upload.progress?.added ?? 0),
      0,
    )
    return {
      importing: true,
      line: copy.adding(added),
      link: review?.link ?? null,
      after: joined([
        review?.after ?? null,
        onReviewStep ? copy.payOnceAdded : null,
      ]),
    }
  }
  if (!mine) return NONE
  if (mine.status === 'failed') {
    return {
      ...NONE,
      line: copy.failed,
      link: { text: copy.failedLink, href: uploadDetailPath(mine.id) },
      after: copy.failedAfter,
    }
  }
  return {
    ...NONE,
    line: copy.added(mine.matchedCount + mine.newCount),
    link: review?.link ?? null,
    after: review?.after ?? null,
  }
}
