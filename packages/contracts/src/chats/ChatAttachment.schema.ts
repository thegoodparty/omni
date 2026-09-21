import { z } from 'zod'
import { zCoerceDate } from '../shared/Date.schema'
import {
  ChatAttachmentSourceSchema,
  ChatAttachmentStatusSchema,
} from '../generated/enums'

export {
  CHAT_ATTACHMENT_SOURCE_VALUES,
  ChatAttachmentSourceSchema,
  type ChatAttachmentSource,
  CHAT_ATTACHMENT_STATUS_VALUES,
  ChatAttachmentStatusSchema,
  type ChatAttachmentStatus,
} from '../generated/enums'

export const CHAT_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024
export const CHAT_ATTACHMENT_MAX_PAGES = 100
export const CHAT_ATTACHMENTS_PER_CONVERSATION = 10

export const CHAT_ATTACHMENT_ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
] as const

export const ChatAttachmentSchema = z.object({
  id: z.string(),
  source: ChatAttachmentSourceSchema,
  sourceUrl: z.string().nullable().optional(),
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  pageCount: z.number().int().nullable().optional(),
  status: ChatAttachmentStatusSchema,
  failureReason: z.string().nullable().optional(),
  createdAt: zCoerceDate(),
})
export type ChatAttachment = z.infer<typeof ChatAttachmentSchema>

export const PresignRequestSchema = z
  .object({
    fileName: z.string().min(1).max(255),
    mimeType: z.enum(CHAT_ATTACHMENT_ALLOWED_MIME_TYPES),
    sizeBytes: z.number().int().positive().max(CHAT_ATTACHMENT_MAX_BYTES),
  })
  .strict()
export type PresignRequest = z.infer<typeof PresignRequestSchema>

export const PresignResponseSchema = z.object({
  attachmentId: z.string(),
  uploadUrl: z.string(),
  uploadFields: z.record(z.string(), z.string()),
  storageKey: z.string(),
})
export type PresignResponse = z.infer<typeof PresignResponseSchema>

export const FinalizeRequestSchema = z
  .object({
    storageKey: z.string(),
  })
  .strict()
export type FinalizeRequest = z.infer<typeof FinalizeRequestSchema>

export const LinkAttachRequestSchema = z
  .object({
    url: z
      .string()
      .url()
      .max(2048)
      .refine(
        (u) => {
          try {
            const { protocol } = new URL(u)
            return protocol === 'http:' || protocol === 'https:'
          } catch {
            return false
          }
        },
        { message: 'URL scheme must be http or https' },
      ),
  })
  .strict()
export type LinkAttachRequest = z.infer<typeof LinkAttachRequestSchema>

export const LinkAttachResponseSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), attachment: ChatAttachmentSchema }),
  z.object({
    ok: z.literal(false),
    error: z.enum([
      'unreachable',
      'blocked_url',
      'unsupported_content_type',
      'too_large',
      'timeout',
      'attachment_limit_reached',
    ]),
  }),
])
export type LinkAttachResponse = z.infer<typeof LinkAttachResponseSchema>

export const ChatAttachmentListResponseSchema = z.object({
  attachments: z.array(ChatAttachmentSchema),
})
export type ChatAttachmentListResponse = z.infer<
  typeof ChatAttachmentListResponseSchema
>

export const ChatAttachmentDownloadResponseSchema = z.object({
  url: z.string(),
  expiresAt: zCoerceDate(),
})
export type ChatAttachmentDownloadResponse = z.infer<
  typeof ChatAttachmentDownloadResponseSchema
>

export const ChatMessageSegmentCitationPayloadSchema = z.object({
  attachmentId: z.string(),
  page: z.number().int().optional(),
  charRange: z.tuple([z.number().int(), z.number().int()]).optional(),
  quotedText: z.string(),
})
export type ChatMessageSegmentCitationPayload = z.infer<
  typeof ChatMessageSegmentCitationPayloadSchema
>
