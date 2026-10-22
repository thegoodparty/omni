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

// The words the official agrees to when approving the invite ("I approve
// GoodParty sending this invite in my name."). Stored on the enrollment, so
// change it whenever those words change: each approval then records which
// words it agreed to.
export const MANAGED_CIVIC_PANEL_CONSENT_VERSION =
  'managed-panel-invite-2026-10-22'

// The hidden turn the Serve home sends when the official presses Build my
// civic panel (the home card or the intro's next step): the Chief of Staff
// explains how GoodParty builds the panel and offers the invite. A fixed
// string: the chat hides it on reload by its exact words, and gp-api titles
// the conversation off it.
export const START_MANAGED_CIVIC_PANEL_MARKER = '[Set up civic panel]'
export const START_MANAGED_CIVIC_PANEL_MESSAGE = `${START_MANAGED_CIVIC_PANEL_MARKER} Build my civic panel for me.`

// What the official sends when they ask to see the invite. Visible: they
// picked it, as an answer.
export const SHOW_MANAGED_CIVIC_PANEL_INVITE = 'Show me the invite'

// The hidden turns the chat sends when the invite review closes, so the
// Chief of Staff hears whether the official set the panel up or backed out.
// Real English rather than sentinels: they persist as user turns. The chat
// hides them by their exact words.
export const MANAGED_CIVIC_PANEL_SET_UP_MESSAGE =
  'I approved the invite and set up my civic panel.'
export const MANAGED_CIVIC_PANEL_BACKED_OUT_MESSAGE =
  'I closed the invite without setting up my civic panel.'
