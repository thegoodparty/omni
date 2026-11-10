import type { ContactUpload } from '@goodparty_org/contracts'
import type { EmailSurface } from './emailSurface'

export type EmailImportStatus = {
  // An upload is still being matched, so the count and price can still
  // change: gp-api refuses confirm until it is done.
  importing: boolean
  line: string | null
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
    const needsInput = processing.reduce(
      (sum, upload) => sum + (upload.progress?.needsInput ?? 0),
      0,
    )
    return {
      importing: true,
      line: [
        copy.adding(added),
        needsInput > 0 ? copy.needReview(needsInput) : null,
        onReviewStep ? copy.payOnceAdded : null,
      ]
        .filter(Boolean)
        .join(' '),
    }
  }
  const mine = uploads.find((upload) => upload.id === flowUploadId)
  if (!mine) return { importing: false, line: null }
  if (mine.status === 'failed') return { importing: false, line: copy.failed }
  const added = copy.added(mine.matchedCount + mine.newCount)
  return {
    importing: false,
    line:
      mine.status === 'needs_input' && mine.needsInputCount > 0
        ? `${added} ${copy.needReview(mine.needsInputCount)}`
        : added,
  }
}
