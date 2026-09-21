import { z } from 'zod'
import { OutreachAwaitingResultsItemSchema } from '@goodparty_org/contracts'

// Shapes this page needs that the W0 contract lock does not carry yet.
// They live here, not in `packages/contracts`, because `contracts/src/index.ts`
// is a hot file owned by W0 and B2. When B2 builds the endpoints it should
// lift these two schemas into `ServeSms.schema.ts` and this file should
// re-export from there instead.

// What the per-send upload page must show before it accepts a file: the send
// it is about, in enough detail that a human can tell they are on the right
// one. The awaiting-results item is everything the inbox needs; the upload
// page additionally needs the message body, which is the thing fulfilment
// actually sent and therefore the thing they can recognize.
export const OutreachResultsTargetSchema =
  OutreachAwaitingResultsItemSchema.extend({
    message: z.string().nullable(),
    imageUrl: z.string().nullable(),
    // Set once results have been ingested. A send that already has results is
    // still openable (re-upload is idempotent server-side) but says so.
    resultsReceivedAt: z.coerce.date().nullable(),
  })
export type OutreachResultsTarget = z.infer<typeof OutreachResultsTargetSchema>

// The upload request. The file travels as raw text rather than parsed rows
// because routing is server-side and a poll's file has to land in
// `input/<pollId>.csv` exactly as fulfilment produced it — re-serializing
// parsed rows would hand the analysis pipeline a different file than the one
// the operator looked at.
export const OutreachResultsUploadRequestSchema = z.object({
  fileName: z.string().min(1).max(255),
  csv: z.string().min(1),
  // True asks for the report and nothing else. The page never commits without
  // having shown one first.
  dryRun: z.boolean(),
  // Who produced the file, for the ingest audit trail.
  sourceLabel: z.string().min(1).max(255),
})
export type OutreachResultsUploadRequest = z.infer<
  typeof OutreachResultsUploadRequestSchema
>

// gp-api rejects a body over its own limit long before a browser struggles
// with the file, and a results CSV for a 5,000-recipient send is well under
// a megabyte. Refusing early gives a readable message instead of a 413.
export const MAX_RESULTS_FILE_BYTES = 5 * 1024 * 1024

export const OUTREACH_TYPE_LABELS: Record<string, string> = {
  text: 'SMS',
  poll: 'Poll',
}

export const outreachTypeLabel = (type: string): string =>
  OUTREACH_TYPE_LABELS[type] ?? type
