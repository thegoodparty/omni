import { z } from 'zod'

export const SCALE_TO_WIN_CAMPAIGN_STATUSES = [
  'DRAFT',
  'INITIAL_SEND_READY',
  'INITIAL_SEND_SCHEDULED',
  'INITIAL_SEND_RUNNING',
  'INITIAL_SEND_CANCELING',
  'INITIAL_SEND_COMPLETE',
  'ARCHIVED',
  'PARTIAL_SEND_EVALUATION_PENDING',
] as const

export const ScaleToWinCampaignStatusSchema = z.enum(
  SCALE_TO_WIN_CAMPAIGN_STATUSES,
)
export type ScaleToWinCampaignStatus = z.infer<
  typeof ScaleToWinCampaignStatusSchema
>

export const ScaleToWinJobStatusSchema = z.enum([
  'NOT_RUNNING',
  'RUNNING',
  'INTERRUPTED',
  'FAILED',
  'DONE',
])
export type ScaleToWinJobStatus = z.infer<typeof ScaleToWinJobStatusSchema>

// E.164, US only: every number we send from is a +1 number.
const UsPhoneNumberSchema = z.string().regex(/^\+1\d{10}$/)

const TimeOfDaySchema = z.string().regex(/^\d{2}:\d{2}:\d{2}$/)

export const ScaleToWinScriptVariantSchema = z.object({ script: z.string() })

export const CopyCampaignBodySchema = z.object({
  name: z.string().min(3).max(255),
  contactFields: z.array(z.string()),
  scriptVariants: z.array(ScaleToWinScriptVariantSchema).min(1),
  sendingPhoneNumber: UsPhoneNumberSchema,
})
export type CopyCampaignBody = z.infer<typeof CopyCampaignBodySchema>

// The texting-hours fields are null when the campaign doesn't override the
// subaccount default, so they are present-but-nullable, not optional.
export const ScaleToWinCampaignSchema = z.object({
  id: z.string(),
  status: ScaleToWinCampaignStatusSchema,
  scriptVariants: z.array(ScaleToWinScriptVariantSchema),
  textingHoursTimezone: z.string().nullable(),
  textingHoursStart: TimeOfDaySchema.nullable(),
  textingHoursEnd: TimeOfDaySchema.nullable(),
  name: z.string().nullish(),
  startedAt: z.string().nullish(),
  contactCount: z.number().int().nullish(),
  sendingPhoneNumber: z.string().nullish(),
  adminUrl: z.string().nullish(),
})
export type ScaleToWinCampaign = z.infer<typeof ScaleToWinCampaignSchema>

export const PreviewMessagesBodySchema = z.object({
  phoneNumber: UsPhoneNumberSchema,
  sampleContactData: z.record(z.string(), z.string()),
})
export type PreviewMessagesBody = z.infer<typeof PreviewMessagesBodySchema>

const ScaleToWinIssueSchema = z.union([
  z.string(),
  z.object({
    message: z.string().nullish(),
    code: z.union([z.string(), z.number()]).nullish(),
  }),
])

export const PreviewMessagesResponseSchema = z.object({
  messages: z.array(
    z.object({
      status: z.string(),
      providerErrorCode: z.union([z.string(), z.number()]).nullish(),
    }),
  ),
  errors: z.array(ScaleToWinIssueSchema),
})
export type PreviewMessagesResponse = z.infer<
  typeof PreviewMessagesResponseSchema
>

export const ScaleToWinJobSchema = z.object({
  status: ScaleToWinJobStatusSchema,
  error: ScaleToWinIssueSchema.nullish(),
})
export type ScaleToWinJob = z.infer<typeof ScaleToWinJobSchema>

// POST /start only kicks the job off; the outcome is read from GET /start.
export const StartCampaignResponseSchema = z.object({
  status: ScaleToWinJobStatusSchema.nullish(),
})
