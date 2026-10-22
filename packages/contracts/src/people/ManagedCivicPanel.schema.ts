import { z } from 'zod'
import { zDate } from '../shared/Date.schema'
import { SMS_COMPOSED_MAX_LENGTH } from '../outreach/OutreachSms.schema'

// The civic panel GoodParty builds for an office once the official approves
// it (/v1/contacts/civic-panel/managed). The official approves one invite
// text; GoodParty then sends it in free, texts-only waves until the panel
// reaches the district's goal.

export const MANAGED_CIVIC_PANEL_STATUSES = [
  'building',
  'ready',
  'paused',
  'stopped',
] as const
export const ManagedCivicPanelStatusSchema = z.enum(
  MANAGED_CIVIC_PANEL_STATUSES,
)
export type ManagedCivicPanelStatus = z.infer<
  typeof ManagedCivicPanelStatusSchema
>

// The approval. The invite must carry the locked JOIN line and the STOP
// opt-out; gp-api checks both, since the words are what the reply reader
// and the opt-out depend on.
export const ApproveManagedCivicPanelInputSchema = z
  .object({
    inviteMessage: z.string().trim().min(1).max(SMS_COMPOSED_MAX_LENGTH),
    consentVersion: z.string().trim().min(1).max(100),
  })
  .strict()
export type ApproveManagedCivicPanelInput = z.infer<
  typeof ApproveManagedCivicPanelInputSchema
>

export const MANAGED_CIVIC_PANEL_ACTIONS = ['pause', 'resume', 'stop'] as const
export const UpdateManagedCivicPanelInputSchema = z
  .object({ action: z.enum(MANAGED_CIVIC_PANEL_ACTIONS) })
  .strict()
export type UpdateManagedCivicPanelInput = z.infer<
  typeof UpdateManagedCivicPanelInputSchema
>

// `nextWaveAt` is when the reply window of the latest sent wave closes while
// the panel is building, the earliest the next wave can go; null otherwise.
export const ManagedCivicPanelProgressSchema = z.object({
  members: z.number().int(),
  goalMembers: z.number().int(),
  wavesSent: z.number().int(),
  nextWaveAt: zDate().nullable(),
})
export type ManagedCivicPanelProgress = z.infer<
  typeof ManagedCivicPanelProgressSchema
>

export const ManagedCivicPanelSchema = z.object({
  id: z.string(),
  status: ManagedCivicPanelStatusSchema,
  inviteMessage: z.string(),
  consentVersion: z.string(),
  approvedAt: zDate(),
  approvedByUserId: z.number().int().nullable(),
  goalMembers: z.number().int(),
  freeTextCap: z.number().int(),
  freeTextsUsed: z.number().int(),
  readyAt: zDate().nullable(),
  pausedAt: zDate().nullable(),
  stoppedAt: zDate().nullable(),
  createdAt: zDate(),
  updatedAt: zDate(),
  progress: ManagedCivicPanelProgressSchema,
})
export type ManagedCivicPanel = z.infer<typeof ManagedCivicPanelSchema>

// Null until the office approves.
export const ManagedCivicPanelResponseSchema = z.object({
  panel: ManagedCivicPanelSchema.nullable(),
})
export type ManagedCivicPanelResponse = z.infer<
  typeof ManagedCivicPanelResponseSchema
>
