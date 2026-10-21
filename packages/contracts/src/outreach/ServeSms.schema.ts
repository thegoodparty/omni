import { z } from 'zod'
import { OutreachEventDetailsSchema } from './OutreachEvent.schema'
import { ServeSmsPurposeSchema } from './OutreachPurpose.schema'
import { SocialToneSchema } from './OutreachSocial.schema'
import { SMS_COMPOSED_MAX_LENGTH } from './OutreachSms.schema'
import { ProposalLinkSchema } from '../chats/ChatCard.schema'
import { MAX_LIST_SAMPLE_SIZE } from '../people/ListSample.schema'

// Serve SMS: texting for elected officials. Fulfilled by the shared delivery
// layer (CSV to Slack today, a vendor later), never by Peerly — an elected
// official has no campaign and so no 10DLC registration to send under.
//
// Serve reuses the Win composed-length cap. The message is the same artifact
// on both surfaces; only the vocabulary and the fulfilment path differ.

// --- Compose -------------------------------------------------------------

// Mirrors SmsDraftRequestSchema with the purpose swapped to the serve
// vocabulary, the same way ServePhoneBankingScriptDraftRequestSchema mirrors
// its Win twin. The SMS list, so it carries the panel-building purpose too.
export const ServeSmsDraftRequestSchema = z.object({
  purpose: ServeSmsPurposeSchema,
  tone: SocialToneSchema,
  currentDraft: z.string().min(1).max(SMS_COMPOSED_MAX_LENGTH).optional(),
  event: OutreachEventDetailsSchema.optional(),
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
// A priority's round 2 is drawn this many business days before its send
// date: the last day a Serve text for that date can still be booked (more
// than 2 business days out), so staff keep their usual lead. Its send date
// has to be later than this from today.
export const ROUND_TWO_DRAW_LEAD_BUSINESS_DAYS = 3

// A priority's text is one purchase sent in two rounds: this share goes out
// at random on the chosen date, and the rest is held as a follow-up, drawn
// once replies are in toward the groups heard from least. Half keeps round 1
// large enough to show which groups lag and round 2 large enough to steer;
// the gain is flat across 40 to 60%, so tune it once answer rates are in.
export const ROUND_ONE_TEXT_SHARE = 0.5
// The follow-up goes out this many business days (two weeks) after round 1:
// replies come in over three, and its draw is three before it sends.
export const FOLLOW_UP_BUSINESS_DAYS = 10
// Neither round goes below a Serve text's own minimum, so a small purchase
// goes out whole in round 1.
export const MIN_TEXTS_PER_ROUND = 25

export const splitPriorityText = (
  total: number,
): { now: number; followUp: number } => {
  const now = Math.ceil(total * ROUND_ONE_TEXT_SHARE)
  return total - now < MIN_TEXTS_PER_ROUND || now < MIN_TEXTS_PER_ROUND
    ? { now: total, followUp: 0 }
    : { now, followUp: total - now }
}

export const ServeSmsCreateRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(255),
    message: z.string().min(1).max(SMS_COMPOSED_MAX_LENGTH),
    // Required: the image makes every Serve text an MMS, which is what lets
    // the message run to SMS_COMPOSED_MAX_LENGTH without segmenting.
    imageUrl: z.string().url(),
    // The send day as a local calendar date. At least 2 business days out and
    // no more than 30, weekends excluded; enforced server-side, not just by the
    // picker.
    scheduledLocalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    voterFileFilterId: z.number().int().positive(),
    // The earlier text this one reports back on. It marks the send as a
    // report back rather than a new ask, and is how its card is completed.
    reportBackForOutreachId: z.number().int().positive().optional(),
    // A priority's follow-up: this many more texts paid for in the same
    // checkout, sent FOLLOW_UP_BUSINESS_DAYS after this one and drawn a few
    // business days before, from the same criteria, toward the groups the
    // priority's answers say least about. Needs the priority it belongs to.
    roundTwoSize: z
      .number()
      .int()
      .positive()
      .max(MAX_LIST_SAMPLE_SIZE)
      .optional(),
  })
  .extend(ProposalLinkSchema.shape)
export type ServeSmsCreateRequest = z.infer<typeof ServeSmsCreateRequestSchema>

export const ServeSmsCreateResponseSchema = z.object({
  outreachId: z.number().int().positive(),
  // Server-derived from the saved list with the opt-out scrub applied. Never
  // a client count: this is what the pay step quotes.
  recipientCount: z.number().int().nonnegative(),
  excludedOptedOutCount: z.number().int().nonnegative(),
  excludedDuplicateCount: z.number().int().nonnegative(),
  // The follow-up held from the same purchase, priced with this one. Absent
  // when none was asked for or the pool left too few to send one.
  followUp: z
    .object({
      outreachId: z.number().int().positive(),
      recipientCount: z.number().int().nonnegative(),
      scheduledLocalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    })
    .optional(),
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
