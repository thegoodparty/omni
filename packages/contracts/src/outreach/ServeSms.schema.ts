import { z } from 'zod'
import { ServeOutreachPurposeSchema } from './OutreachPurpose.schema'
import { SocialToneSchema } from './OutreachSocial.schema'
import { SMS_COMPOSED_MAX_LENGTH } from './OutreachSms.schema'

// Serve SMS: texting for elected officials. Fulfilled by the shared delivery
// layer (CSV to Slack today, a vendor later), never by Peerly — an elected
// official has no campaign and so no 10DLC registration to send under.
//
// Serve reuses the Win composed-length cap. The message is the same artifact
// on both surfaces; only the vocabulary and the fulfilment path differ.

// --- Compose -------------------------------------------------------------

// Mirrors SmsDraftRequestSchema with the purpose swapped to the serve
// vocabulary, the same way ServePhoneBankingScriptDraftRequestSchema mirrors
// its Win twin.
export const ServeSmsDraftRequestSchema = z.object({
  purpose: ServeOutreachPurposeSchema,
  tone: SocialToneSchema,
  currentDraft: z.string().min(1).max(SMS_COMPOSED_MAX_LENGTH).optional(),
})
export type ServeSmsDraftRequest = z.infer<typeof ServeSmsDraftRequestSchema>

export const ServeSmsDraftResponseSchema = z.object({
  draft: z.string().min(1).max(SMS_COMPOSED_MAX_LENGTH),
})
export type ServeSmsDraftResponse = z.infer<typeof ServeSmsDraftResponseSchema>

// --- Create --------------------------------------------------------------

// Draft-first, like the Win p2p flow: the row is persisted `pending_payment`
// before checkout, because the composed message can reach 1000 characters and
// Stripe metadata caps a value at 500, so the poll pattern of carrying content
// through checkout metadata cannot work here.
//
// No scheduledLocalTime. Serve sends at a fixed 11am local, matching what
// polls already ships, so the time is a constant rather than a choice — see
// docs/features/serve-sms.md, "Send timing".
export const ServeSmsCreateRequestSchema = z.object({
  name: z.string().trim().min(1).max(255),
  message: z.string().min(1).max(SMS_COMPOSED_MAX_LENGTH),
  imageUrl: z.string().url().optional(),
  // The send day as a local calendar date. At least 2 business days out and
  // no more than 30, weekends excluded; enforced server-side, not just by the
  // picker.
  scheduledLocalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  voterFileFilterId: z.number().int().positive(),
})
export type ServeSmsCreateRequest = z.infer<typeof ServeSmsCreateRequestSchema>

export const ServeSmsCreateResponseSchema = z.object({
  outreachId: z.number().int().positive(),
  // Server-derived from the saved list with the opt-out scrub applied. Never
  // a client count: this is what the pay step quotes.
  recipientCount: z.number().int().nonnegative(),
  excludedOptedOutCount: z.number().int().nonnegative(),
  excludedDuplicateCount: z.number().int().nonnegative(),
})
export type ServeSmsCreateResponse = z.infer<
  typeof ServeSmsCreateResponseSchema
>

// --- Results upload (staff) ----------------------------------------------

// One parsed row of a fulfilment results CSV. Header spellings the analysis
// pipeline already accepts are normalized to these before validation, so
// fulfilment does not learn a second format.
export const OutreachResultsUploadRowSchema = z.object({
  phone: z.string().min(1),
  // Deliberately NOT min(1): an inbound row with no text is a real reply.
  // An MMS carrying only an image, a tapback, an emoji the export strips —
  // the constituent did respond, and `respondedAt` should say so. Review
  // asked for min(1) on the grounds that a blank marks a non-responder as
  // having answered; that reasoning does not survive the direction filter,
  // which is what actually separates a reply from the outbound half.
  content: z.string(),
  receivedAt: z.coerce.date().optional(),
})
export type OutreachResultsUploadRow = z.infer<
  typeof OutreachResultsUploadRowSchema
>

// Reported before anything is committed. Silent partial failure is the
// current failure mode of the `aws s3 cp` path this replaces, so the count
// that matters most is `unmatched`: rows whose number belongs to nobody on
// this send.
export const OutreachResultsParseReportSchema = z.object({
  rowsParsed: z.number().int().nonnegative(),
  /**
   * Rows of the export that were the official's OWN outbound message, not
   * replies. The fulfilment file is a message log and carries one per
   * recipient, so this is routinely larger than every other count here.
   *
   * Counted separately rather than folded into `unmatched`, which it
   * silently inflated: a 32-recipient send reported 33 unmatched rows when
   * exactly one reply came from a number not on the send. `unmatched` is
   * the number an operator acts on, so it has to mean only that.
   */
  outboundRows: z.number().int().nonnegative(),
  /**
   * Null for a poll, where they have no meaning rather than a value of
   * zero. A poll file is forwarded to the analysis pipeline, not ingested:
   * there is no recipient map to match a reply against and no opt-out
   * predicate run here, so reporting 0 would read as "nobody replied" when
   * the truth is that the pipeline answers that later by writing PollIssues.
   * A reader that shows these must hide them when they are null.
   */
  matched: z.number().int().nonnegative().nullable(),
  unmatched: z.number().int().nonnegative().nullable(),
  optOuts: z.number().int().nonnegative().nullable(),
  // false on a dry run, true once the rows are written. Always present — an
  // earlier version of this comment said "absent once written", which would
  // have led an implementer to omit it and have Zod reject every real result.
  committed: z.boolean(),
})
export type OutreachResultsParseReport = z.infer<
  typeof OutreachResultsParseReportSchema
>

/**
 * One product's work in the staff results inbox. The inbox is what makes
 * "we never got results back" visible rather than absent.
 *
 * `sms` is an Outreach row; `poll` is a Poll row, a different table with a
 * uuid key. That is why `id` is a string rather than the integer this
 * carried while the inbox was SMS-only: the two id spaces overlap
 * numerically and do not share a table, so the kind has to travel with it.
 * Every reader must switch on `kind` before doing anything with `id`.
 */
export const ResultsInboxKindSchema = z.enum(['sms', 'poll'])
export type ResultsInboxKind = z.infer<typeof ResultsInboxKindSchema>

export const OutreachAwaitingResultsItemSchema = z.object({
  kind: ResultsInboxKindSchema,
  id: z.string().min(1),
  name: z.string().nullable(),
  organizationSlug: z.string(),
  outreachType: z.string(),
  recipientCount: z.number().int().nonnegative(),
  sentAt: z.coerce.date().nullable(),
  expectedBy: z.coerce.date().nullable(),
})
export type OutreachAwaitingResultsItem = z.infer<
  typeof OutreachAwaitingResultsItemSchema
>

export const OutreachAwaitingResultsResponseSchema = z.object({
  items: z.array(OutreachAwaitingResultsItemSchema),
})
export type OutreachAwaitingResultsResponse = z.infer<
  typeof OutreachAwaitingResultsResponseSchema
>

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
// because routing is server-side and the server, not the page, is the
// authority on what the file says — the page's own parse is a preflight that
// saves a round trip and decides nothing.
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
