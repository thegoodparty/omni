import { z } from 'zod'

export const AGENT_AUDIENCE_SHORTFALL_TOLERANCE = 0.15

export const HandoffActionSchema = z.enum([
  'schedule',
  'confirm_scheduled',
  'export_replies',
])
export type HandoffAction = z.infer<typeof HandoffActionSchema>

export const AgentHandoffItemSchema = z.object({
  outreachId: z.number().int(),
  action: HandoffActionSchema,
  mode: z.enum(['shadow', 'auto']),
  wave: z.number().int(),
  official: z.object({
    name: z.string(),
    city: z.string().nullable(),
    state: z.string(),
  }),
  message: z.string(),
  recipientCount: z.number().int(),
  sendAt: z.string().datetime(),
  timeZone: z.string(),
  campaignName: z.string(),
  vendorCampaignName: z.string().nullable(),
  repliesDueAt: z.string().datetime().nullable(),
})
export type AgentHandoffItem = z.infer<typeof AgentHandoffItemSchema>

export const AgentHandoffListResponseSchema = z.object({
  items: z.array(AgentHandoffItemSchema),
})
export type AgentHandoffListResponse = z.infer<
  typeof AgentHandoffListResponseSchema
>

export const AgentHandoffClaimResponseSchema = z.object({
  claimToken: z.string(),
  recipientsCsvUrl: z.string().url(),
  claimExpiresAt: z.string().datetime(),
})
export type AgentHandoffClaimResponse = z.infer<
  typeof AgentHandoffClaimResponseSchema
>

const vendorCampaignFields = {
  claimToken: z.string(),
  vendorCampaignName: z.string(),
  sendingNumber: z.string(),
  audienceCount: z.number().int(),
}

export const AgentHandoffReportSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('built'),
    ...vendorCampaignFields,
  }),
  z.object({
    status: z.literal('scheduled'),
    ...vendorCampaignFields,
    scheduledFor: z.string().datetime(),
  }),
  z.object({
    status: z.literal('needs_human'),
    claimToken: z.string(),
    step: z.enum(['login', 'schedule', 'confirm', 'replies']),
    reason: z.string().max(500),
  }),
])
export type AgentHandoffReport = z.infer<typeof AgentHandoffReportSchema>
