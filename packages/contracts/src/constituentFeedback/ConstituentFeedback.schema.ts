import { z } from 'zod'
import { zCoerceDate } from '../shared/Date.schema'
import {
  ConstituentFeedbackCaptureMethodSchema,
  ConstituentFeedbackExtractionStatusSchema,
  ConstituentFeedbackStanceSchema,
  IssueTagStatusSchema,
} from '../generated/enums'

// A dictated summary of one conversation. Long enough for a rambling minute
// of speech, short enough that a runaway socket cannot post a novel — the
// design target is ten seconds.
export const CONSTITUENT_FEEDBACK_TRANSCRIPT_MAX_LENGTH = 4_000
// An issue label is a phrase ("Flock cameras", "street flooding"), never a
// sentence. Capped tight because the synthesis phase clusters these, and a
// label that is secretly a paragraph poisons the clustering.
export const CONSTITUENT_FEEDBACK_ISSUE_LABEL_MAX_LENGTH = 120
export const CONSTITUENT_FEEDBACK_DESIRED_OUTCOME_MAX_LENGTH = 1_000
// `constituent-feedback/{organizationSlug}/{clientKey}.webm`, with room for a
// long slug.
export const CONSTITUENT_FEEDBACK_AUDIO_KEY_MAX_LENGTH = 300

// The triple: what the constituent cares about, where they stand on it, and
// what they would change if they could. Every field is nullable because a
// memo can name an issue without a position, or a complaint without a remedy,
// and a partial answer is a real record rather than a failed one.
//
// `desiredOutcome` is the magic-wand answer, not the reason behind the
// position. It is the field that turns a count into something an elected
// official can act on, and the reason survives in the transcript anyway.
export const ConstituentFeedbackTripleSchema = z.object({
  issueLabel: z
    .string()
    .max(CONSTITUENT_FEEDBACK_ISSUE_LABEL_MAX_LENGTH)
    .nullable(),
  stance: ConstituentFeedbackStanceSchema.nullable(),
  desiredOutcome: z
    .string()
    .max(CONSTITUENT_FEEDBACK_DESIRED_OUTCOME_MAX_LENGTH)
    .nullable(),
})
export type ConstituentFeedbackTriple = z.infer<
  typeof ConstituentFeedbackTripleSchema
>

// What the surface sends. organizationSlug comes from auth, actorUserId from
// the session, occurredAt is server-stamped, and personId resolves from the
// interaction being referenced — so none of them appear here.
//
// The channel arms carry different references because the two surfaces have
// different durable handles on the row they just wrote, and neither returns
// its interaction id:
//
//   - A knock persists the client-minted `clientKey` as its `sourceId`, so
//     the phone already holds a key that resolves the row it wrote, offline,
//     before the memo is even recorded.
//   - A call upserts on (phoneBankingListId, personId) and mints no key, so
//     the entry plus who picked up is the only handle the caller has.
//
// A discriminated union rather than two nullable ids and a refine: "exactly
// one reference, matching the channel" is then a fact about the type instead
// of a runtime check that every reader has to remember.
const RecordConstituentFeedbackBase = {
  // This memo's own replay-idempotency key, distinct from the knock's. A
  // dead-zone retry re-sends the same key and upserts the same row.
  clientKey: z.guid(),
  // The words, when the phone has them: dictated live or typed.
  transcript: z
    .string()
    .min(1)
    .max(CONSTITUENT_FEEDBACK_TRANSCRIPT_MAX_LENGTH)
    .optional(),
  // The recording, when the phone had no signal to dictate over: the key
  // `POST audio-upload-url` handed out, already holding the audio. The
  // server transcribes it later, so the memo arrives with no text.
  audioKey: z
    .string()
    .min(1)
    .max(CONSTITUENT_FEEDBACK_AUDIO_KEY_MAX_LENGTH)
    .optional(),
  captureMethod: ConstituentFeedbackCaptureMethodSchema,
}

// Exactly one source of words, and a capture method that agrees with it:
// `dictation_offline` is what tells a server-transcribed memo apart from one
// dictated live, so it comes with a recording and only with one.
const requireOneSource = (
  memo: {
    transcript?: string
    audioKey?: string
    captureMethod: z.infer<typeof ConstituentFeedbackCaptureMethodSchema>
  },
  ctx: z.RefinementCtx,
): void => {
  const hasText = memo.transcript !== undefined
  const hasRecording = memo.audioKey !== undefined
  if (hasText === hasRecording) {
    ctx.addIssue({
      code: 'custom',
      message: 'Send exactly one of transcript or audioKey',
      path: ['transcript'],
    })
  }
  if (hasRecording !== (memo.captureMethod === 'dictation_offline')) {
    ctx.addIssue({
      code: 'custom',
      message: 'captureMethod dictation_offline goes with audioKey',
      path: ['captureMethod'],
    })
  }
}

export const RecordConstituentFeedbackSchema = z.discriminatedUnion('channel', [
  z
    .object({
      channel: z.literal('door_knock'),
      // The `clientKey` of the knock this memo belongs to, which the server
      // resolves via (organizationSlug, sourceId).
      knockClientKey: z.guid(),
      // The same frozen stop target the knock itself was recorded against.
      // Sent rather than derived because a knock row carries no turf, and the
      // turf is what holds the effort's question — resolving it from the
      // person instead would pick an arbitrary one when the same resident
      // sits in two turfs.
      stopTargetId: z.number().int().positive(),
      ...RecordConstituentFeedbackBase,
    })
    .strict()
    .superRefine(requireOneSource),
  z
    .object({
      channel: z.literal('phone_bank'),
      entryId: z.number().int().positive(),
      personId: z.string(),
      ...RecordConstituentFeedbackBase,
    })
    .strict()
    .superRefine(requireOneSource),
])
export type RecordConstituentFeedback = z.infer<
  typeof RecordConstituentFeedbackSchema
>

// The capture response hands back what the model proposed so the person who
// was just at the door can accept or correct it. `extractionStatus` is
// `failed` when no triple could be produced; the row and its transcript
// persist either way, so the surface shows an empty triple to fill in rather
// than an error.
export const RecordConstituentFeedbackResponseSchema = z.object({
  id: z.string(),
  personId: z.string(),
  extractionStatus: ConstituentFeedbackExtractionStatusSchema,
  // Null when extraction failed.
  extraction: ConstituentFeedbackTripleSchema.nullable(),
})
export type RecordConstituentFeedbackResponse = z.infer<
  typeof RecordConstituentFeedbackResponseSchema
>

// Confirming the triple. This is the whole point of extracting in the request
// rather than on a queue: the canvasser still remembers the conversation, so
// the values they send here are first-hand rather than reconstructed from a
// transcript weeks later by someone who was not there.
//
// The body is the full triple, not a patch, because a confirmation is a
// statement about all three fields — including the ones left null on purpose.
export const ConfirmConstituentFeedbackSchema =
  ConstituentFeedbackTripleSchema.strict()
export type ConfirmConstituentFeedback = z.infer<
  typeof ConfirmConstituentFeedbackSchema
>

// Declared here rather than beside the rest of the tag shapes so the
// synthesis schemas import this file and never the other way round.
export const IssueTagRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: IssueTagStatusSchema,
})
export type IssueTagRef = z.infer<typeof IssueTagRefSchema>

export const ConstituentFeedbackSchema = z.object({
  id: z.string(),
  personId: z.string(),
  occurredAt: zCoerceDate(),
  channel: z.string(),
  transcript: z.string().nullable(),
  issueLabel: z.string().nullable(),
  stance: ConstituentFeedbackStanceSchema.nullable(),
  desiredOutcome: z.string().nullable(),
  extractionStatus: ConstituentFeedbackExtractionStatusSchema,
  confirmedAt: zCoerceDate().nullable(),
  // The outreach envelope the conversation happened under. Null when the
  // phone list it came from was created without one.
  outreachId: z.number().int().nullable(),
  // Who recorded it. Null when the actor's user row has since been removed,
  // matching how the contact feed renders an authorless note.
  actorName: z.string().nullable(),
  // Accepted tags only. A proposal is a suggestion nobody has agreed to, so
  // it shows in the report and the curation list, never on a person.
  tags: z.array(IssueTagRefSchema),
})
export type ConstituentFeedbackRecord = z.infer<
  typeof ConstituentFeedbackSchema
>

export const ConstituentFeedbackListResponseSchema = z.object({
  feedback: z.array(ConstituentFeedbackSchema),
})
export type ConstituentFeedbackListResponse = z.infer<
  typeof ConstituentFeedbackListResponseSchema
>

// The memo's own replay key, which names the recording, so a re-sent upload
// lands on the same object.
export const AudioUploadUrlRequestSchema = z
  .object({ clientKey: z.guid() })
  .strict()
export type AudioUploadUrlRequest = z.infer<typeof AudioUploadUrlRequestSchema>

// Where the phone PUTs the recording it held while it had no signal, and the
// key to send with the memo once it has.
export const AudioUploadUrlResponseSchema = z.object({
  audioKey: z.string(),
  uploadUrl: z.string(),
  expiresAt: zCoerceDate(),
})
export type AudioUploadUrlResponse = z.infer<
  typeof AudioUploadUrlResponseSchema
>

// What re-recording a memo posts to `POST /v1/constituent-feedback`
// alongside its own `clientKey`: the knock or the call it belongs to, in the
// same shape the capture arms take.
export const PendingFeedbackReferenceSchema = z.discriminatedUnion('channel', [
  z.object({
    channel: z.literal('door_knock'),
    knockClientKey: z.string(),
    stopTargetId: z.number().int(),
  }),
  z.object({
    channel: z.literal('phone_bank'),
    entryId: z.number().int(),
    personId: z.string(),
  }),
])
export type PendingFeedbackReference = z.infer<
  typeof PendingFeedbackReferenceSchema
>

// A memo waiting for review, with what "Type it instead" needs to re-record
// it as typed text: a typed note has to become a transcript, because a
// transcript is what synthesis groups. `reference` is null when its knock or
// call can no longer be found, and then the memo cannot be re-recorded.
export const PendingFeedbackSchema = ConstituentFeedbackSchema.extend({
  clientKey: z.string(),
  reference: PendingFeedbackReferenceSchema.nullable(),
})
export type PendingFeedback = z.infer<typeof PendingFeedbackSchema>

// An effort's unconfirmed memos, newest first: the "Notes to review" list.
// A volunteer gets their own; an owner or manager gets everyone's.
export const PendingFeedbackResponseSchema = z.object({
  feedback: z.array(PendingFeedbackSchema),
})
export type PendingFeedbackResponse = z.infer<
  typeof PendingFeedbackResponseSchema
>
