import type { ContactUpload } from '@goodparty_org/contracts'
import {
  UPLOAD_HISTORY_PATH,
  uploadDetailPath,
} from 'app/dashboard/contacts/crm/import/importContactsCopy'
import type { EmailSurface } from './emailSurface'

// The rows waiting on a choice: their upload's page, or Import history when
// more than one upload has some.
export type ImportReview = { count: number; href: string }

export type EmailImportStatus = {
  // An upload is still being matched, so the count and price can still
  // change: gp-api refuses confirm until it is done.
  importing: boolean
  // The line before any review clause and the one after it.
  line: string | null
  review: ImportReview | null
  after: string | null
}

const NONE: EmailImportStatus = {
  importing: false,
  line: null,
  review: null,
  after: null,
}

const reviewOf = (
  uploads: ContactUpload[],
  needsInput: (upload: ContactUpload) => number,
): ImportReview | null => {
  const waiting = uploads.filter((upload) => needsInput(upload) > 0)
  const [only] = waiting
  if (!only) return null
  return {
    count: waiting.reduce((sum, upload) => sum + needsInput(upload), 0),
    href:
      waiting.length === 1 ? uploadDetailPath(only.id) : UPLOAD_HISTORY_PATH,
  }
}

// Every upload still processing counts, wherever it was started, since each
// one holds the send. Once none is, only the one imported in this flow has a
// line, saying how it ended.
export const emailImportStatus = (
  uploads: ContactUpload[],
  flowUploadId: string | null,
  surface: EmailSurface,
  onReviewStep: boolean,
): EmailImportStatus => {
  const copy = surface.importStatus
  const processing = uploads.filter((upload) => upload.status === 'processing')
  if (processing.length > 0) {
    const added = processing.reduce(
      (sum, upload) => sum + (upload.progress?.added ?? 0),
      0,
    )
    return {
      importing: true,
      line: copy.adding(added),
      review: reviewOf(
        processing,
        (upload) => upload.progress?.needsInput ?? 0,
      ),
      after: onReviewStep ? copy.payOnceAdded : null,
    }
  }
  const mine = uploads.find((upload) => upload.id === flowUploadId)
  if (!mine) return NONE
  if (mine.status === 'failed') return { ...NONE, line: copy.failed }
  return {
    ...NONE,
    line: copy.added(mine.matchedCount + mine.newCount),
    review:
      mine.status === 'needs_input'
        ? reviewOf([mine], (upload) => upload.needsInputCount)
        : null,
  }
}
