import { z } from 'zod'
import { OutreachEmailPauseReasonSchema } from '../generated/enums'
import { SocialToneSchema } from './OutreachSocial.schema'
import {
  EMAIL_LAYOUTS,
  EmailLayoutKeySchema,
  EmailThemeKeySchema,
} from './EmailTemplate.const'

export const EMAIL_SUBJECT_MAX_LENGTH = 150
export const EMAIL_HEADLINE_MAX_LENGTH = 150
export const EMAIL_BODY_MAX_LENGTH = 10_000
export const EMAIL_GOAL_MAX_LENGTH = 500
export const EMAIL_BUTTON_LABEL_MAX_LENGTH = 40
export const EMAIL_URL_MAX_LENGTH = 2000
export const EMAIL_UPLOAD_MAX_ROWS = 5000
export const EMAIL_SEND_WINDOW_DAYS = 30

const HttpsUrlSchema = z
  .string()
  .max(EMAIL_URL_MAX_LENGTH)
  .url()
  .refine((url) => url.startsWith('https://'), 'Links must start with https://')

export const EmailDraftSaveSchema = z
  .object({
    id: z.number().int().positive().optional(),
    goal: z.string().trim().min(1).max(EMAIL_GOAL_MAX_LENGTH),
    layout: EmailLayoutKeySchema,
    theme: EmailThemeKeySchema,
    subject: z.string().trim().min(1).max(EMAIL_SUBJECT_MAX_LENGTH),
    headline: z
      .string()
      .trim()
      .min(1)
      .max(EMAIL_HEADLINE_MAX_LENGTH)
      .optional(),
    body: z.string().trim().min(1).max(EMAIL_BODY_MAX_LENGTH),
    imageUrl: HttpsUrlSchema.optional(),
    buttonLabel: z
      .string()
      .trim()
      .min(1)
      .max(EMAIL_BUTTON_LABEL_MAX_LENGTH)
      .optional(),
    buttonUrl: HttpsUrlSchema.optional(),
    date: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    const hasLabel = data.buttonLabel !== undefined
    const hasUrl = data.buttonUrl !== undefined
    if (EMAIL_LAYOUTS[data.layout].requiresButton && !(hasLabel && hasUrl)) {
      ctx.addIssue({
        path: ['buttonLabel'],
        code: 'custom',
        message: 'This layout needs a button label and link',
      })
      return
    }
    if (hasLabel !== hasUrl) {
      ctx.addIssue({
        path: [hasLabel ? 'buttonUrl' : 'buttonLabel'],
        code: 'custom',
        message: 'A button needs both a label and a link',
      })
    }
  })
export type EmailDraftSave = z.infer<typeof EmailDraftSaveSchema>

export const EmailSenderSchema = z.object({
  localPart: z.string(),
  address: z.string(),
  displayName: z.string(),
  forwardToEmail: z.string(),
  pendingForwardToEmail: z.string().nullable(),
  warmingStep: z.number().int().nonnegative(),
})
export type EmailSender = z.infer<typeof EmailSenderSchema>

export const EmailSenderUpdateSchema = z
  .object({ forwardToEmail: z.string().trim().max(254).email() })
  .strict()
export type EmailSenderUpdate = z.infer<typeof EmailSenderUpdateSchema>

export const EmailDraftSchema = z.object({
  id: z.number().int().positive(),
  status: z.string(),
  goal: z.string(),
  layout: z.string(),
  theme: z.string(),
  subject: z.string(),
  headline: z.string().nullable(),
  body: z.string(),
  imageUrl: z.string().nullable(),
  buttonLabel: z.string().nullable(),
  buttonUrl: z.string().nullable(),
  paidForBy: z.string().nullable(),
  date: z.string().nullable(),
  consentConfirmedAt: z.string().nullable(),
  recipientCount: z.number().int().nonnegative(),
})
export type EmailDraft = z.infer<typeof EmailDraftSchema>

// A draft plus what happens once it is confirmed: GET /:id, confirm and
// cancel return this.
export const EmailSendSchema = EmailDraftSchema.extend({
  // Frozen at confirm: how many of the recipients this send can reach.
  recipientCap: z.number().int().nonnegative().nullable(),
  sentCount: z.number().int().nonnegative(),
  pauseReason: z.string().nullable(),
  stopping: z.boolean(),
  // What confirming now would freeze and hold, shown on the review step.
  // Null once the send has left draft.
  estimate: z
    .object({
      warmingCap: z.number().int().nonnegative(),
      recipientCap: z.number().int().nonnegative(),
      priceCents: z.number().int().nonnegative(),
    })
    .nullable(),
})
export type EmailSend = z.infer<typeof EmailSendSchema>

export const EmailConfirmRequestSchema = z
  .object({ paymentMethodId: z.string().trim().min(1).max(255) })
  .strict()
export type EmailConfirmRequest = z.infer<typeof EmailConfirmRequestSchema>

export const EmailConfirmResponseSchema = z.object({
  outcome: z.enum(['held', 'scheduled']),
  email: EmailSendSchema,
})
export type EmailConfirmResponse = z.infer<typeof EmailConfirmResponseSchema>

// The 402 body confirm answers when the card is declined. The send stays a
// draft, and confirming again with another card retries it.
export const EmailConfirmDeclinedSchema = z.object({
  message: z.string(),
  // Stripe's decline_code, else its code, else the intent status
  // (requires_action for a card that needs 3-D Secure).
  declineCode: z.string().nullable(),
})
export type EmailConfirmDeclined = z.infer<typeof EmailConfirmDeclinedSchema>

export const EmailRecipientUploadRequestSchema = z
  .object({
    consentConfirmed: z.union([
      z.literal(true),
      z.literal('true').transform(() => true as const),
    ]),
  })
  .strict()
export type EmailRecipientUploadRequest = z.infer<
  typeof EmailRecipientUploadRequestSchema
>

export const EmailRecipientUploadResponseSchema = z.object({
  ready: z.number().int().nonnegative(),
  invalid: z.number().int().nonnegative(),
  duplicate: z.number().int().nonnegative(),
  unsubscribed: z.number().int().nonnegative(),
})
export type EmailRecipientUploadResponse = z.infer<
  typeof EmailRecipientUploadResponseSchema
>

export const EMAIL_IMAGE_MAX_BYTES = 1_000_000
export const EMAIL_IMAGE_ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
] as const

export const EmailAiDraftFieldsSchema = z.object({
  subject: z.string().trim().min(1).max(EMAIL_SUBJECT_MAX_LENGTH),
  headline: z.string().trim().min(1).max(EMAIL_HEADLINE_MAX_LENGTH).nullable(),
  body: z.string().trim().min(1).max(EMAIL_BODY_MAX_LENGTH),
  buttonLabel: z
    .string()
    .trim()
    .min(1)
    .max(EMAIL_BUTTON_LABEL_MAX_LENGTH)
    .nullable(),
})
export type EmailAiDraftFields = z.infer<typeof EmailAiDraftFieldsSchema>

export const EmailAiDraftRequestSchema = z
  .object({
    goal: z.string().trim().min(1).max(EMAIL_GOAL_MAX_LENGTH),
    tone: SocialToneSchema,
    layout: EmailLayoutKeySchema,
    currentDraft: EmailAiDraftFieldsSchema.optional(),
  })
  .strict()
export type EmailAiDraftRequest = z.infer<typeof EmailAiDraftRequestSchema>

export const EmailAiDraftResponseSchema = EmailAiDraftFieldsSchema
export type EmailAiDraftResponse = EmailAiDraftFields

export const EmailImagePresignRequestSchema = z
  .object({ contentType: z.enum(EMAIL_IMAGE_ALLOWED_MIME_TYPES) })
  .strict()
export type EmailImagePresignRequest = z.infer<
  typeof EmailImagePresignRequestSchema
>

export const EmailImagePresignResponseSchema = z.object({
  url: z.string(),
  fields: z.record(z.string(), z.string()),
  publicUrl: z.string(),
  expiresIn: z.number().int().positive(),
})
export type EmailImagePresignResponse = z.infer<
  typeof EmailImagePresignResponseSchema
>

export const EmailTestSendResponseSchema = z.object({ sentTo: z.string() })
export type EmailTestSendResponse = z.infer<typeof EmailTestSendResponseSchema>

// Staff controls (gp-admin): paused sends with SES's rates since the send's
// last resume. The rates are null when CloudWatch couldn't be read.
export const EmailPausedSendSchema = z.object({
  outreachId: z.number().int(),
  organizationSlug: z.string(),
  senderName: z.string(),
  subject: z.string(),
  pauseReason: OutreachEmailPauseReasonSchema,
  pausedAt: z.string(),
  resumedAt: z.string().nullable(),
  sentCount: z.number().int().nonnegative(),
  recipientCap: z.number().int().nonnegative().nullable(),
  metrics: z
    .object({
      send: z.number().nonnegative(),
      bounce: z.number().nonnegative(),
      complaint: z.number().nonnegative(),
      bounceRate: z.number().nonnegative(),
      complaintRate: z.number().nonnegative(),
    })
    .nullable(),
})
export type EmailPausedSend = z.infer<typeof EmailPausedSendSchema>

export const EmailPausedSendsResponseSchema = z.object({
  items: z.array(EmailPausedSendSchema),
})
export type EmailPausedSendsResponse = z.infer<
  typeof EmailPausedSendsResponseSchema
>
