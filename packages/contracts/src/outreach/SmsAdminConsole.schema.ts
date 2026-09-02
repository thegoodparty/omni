import { z } from 'zod'
import { zCoerceDate } from '../shared/Date.schema'
import { P2P_SCRIPT_MAX_LENGTH } from './OutreachScript.const'

// The CAS SMS console (gp-admin): approval queue, per-campaign monitor,
// and the message-standards verdict. gp-admin consumes these through the
// SDK, so every shape crossing that boundary lives here.

// Derived server-side from the spine's approval stamps + the live Peerly
// job. `awaiting_review` is the actionable state; `denied` stays visible
// until an edit (usually CAS's own) re-queues it or the campaign is
// canceled; `canvass_requested` means the send is booked with the vendor;
// `peerly_approved` means the vendor's own review confirmed it.
export const SMS_APPROVAL_STATUS_VALUES = [
  'awaiting_review',
  'denied',
  'canvass_requested',
  'peerly_approved',
] as const
export const SmsApprovalStatusSchema = z.enum(SMS_APPROVAL_STATUS_VALUES)
export type SmsApprovalStatus = z.infer<typeof SmsApprovalStatusSchema>

// Deterministic message-standards checks (the compliance half of the
// brief's Proposal B). The rule set is the CAS compliance list confirmed
// 2026-09-02: opt-out text, recipient name, candidate name, and the
// "Paid for by <committee>" disclaimer. Rule ids are stable identifiers
// the UI maps to copy.
export const SMS_STANDARDS_RULE_VALUES = [
  'opt_out_line',
  'first_name_token',
  'candidate_name',
  'paid_for_by',
  'length',
] as const
export const SmsStandardsRuleSchema = z.enum(SMS_STANDARDS_RULE_VALUES)
export type SmsStandardsRule = z.infer<typeof SmsStandardsRuleSchema>

export const SmsStandardsVerdictSchema = z.object({
  passed: z.boolean(),
  failures: z.array(SmsStandardsRuleSchema),
})
export type SmsStandardsVerdict = z.infer<typeof SmsStandardsVerdictSchema>

// Pure and shared (compose advisory, server-side verdict, queue chip).
// Name rules match on TOKENS ("Jane" satisfies "Jane Doe"), since real
// scripts identify by first name while filings carry the full one. The
// candidate_name rule only runs when a name to match is supplied; the
// paid_for_by rule always requires the phrase, and additionally a
// committee token when the committee name is known (every campaign that
// can schedule an SMS has one, per the 10DLC requirement). Advisory in
// the staff queue: the human approval stays the gate.
const nameTokensOf = (names: (string | null | undefined)[]): string[] =>
  names
    .filter((name): name is string => !!name)
    .flatMap((name) => name.split(/\s+/))
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length >= 3)

export const checkSmsStandards = (
  script: string,
  context: { candidateNames?: string[]; committeeName?: string | null } = {},
): SmsStandardsVerdict => {
  const failures: SmsStandardsRule[] = []
  const lower = script.toLowerCase()

  if (!/reply\s+stop/i.test(script)) {
    failures.push('opt_out_line')
  }
  if (!script.includes('{first_name}')) {
    failures.push('first_name_token')
  }
  const candidateTokens = nameTokensOf(context.candidateNames ?? [])
  if (
    candidateTokens.length > 0 &&
    !candidateTokens.some((token) => lower.includes(token))
  ) {
    failures.push('candidate_name')
  }
  const committeeTokens = nameTokensOf([context.committeeName])
  const hasPaidForBy = /paid\s+for\s+by/i.test(script)
  const hasCommitteeToken =
    committeeTokens.length === 0 ||
    committeeTokens.some((token) => lower.includes(token))
  if (!hasPaidForBy || !hasCommitteeToken) {
    failures.push('paid_for_by')
  }
  if (script.length > P2P_SCRIPT_MAX_LENGTH) {
    failures.push('length')
  }

  return { passed: failures.length === 0, failures }
}

export const SmsApprovalQueueItemSchema = z.object({
  id: z.number(),
  campaignId: z.number(),
  campaignSlug: z.string(),
  candidateName: z.string().nullable(),
  name: z.string().nullable(),
  createdAt: zCoerceDate(),
  sendAt: zCoerceDate().nullable(),
  scheduledLocalDate: z.string().nullable(),
  script: z.string().nullable(),
  imageUrl: z.string().nullable(),
  textCount: z.number().nullable(),
  billableTextCount: z.number().nullable(),
  // A free-texts send never records a checkout session.
  paid: z.boolean(),
  approvalStatus: SmsApprovalStatusSchema,
  approvedAt: zCoerceDate().nullable(),
  approvedBy: z.string().nullable(),
  deniedAt: zCoerceDate().nullable(),
  deniedBy: z.string().nullable(),
  deniedReason: z.string().nullable(),
  canvassRequestedAt: zCoerceDate().nullable(),
  adminEditedAt: zCoerceDate().nullable(),
  adminEditedBy: z.string().nullable(),
  standards: SmsStandardsVerdictSchema.nullable(),
  // Live Peerly job readiness; null when the live read failed (the queue
  // must not 502 because one identity's vendor read did).
  job: z
    .object({
      status: z.string(),
      deliverabilityCheckError: z.string().nullable(),
      hasCanvassersScheduled: z.boolean(),
      peerlyApproved: z.boolean().nullable(),
      leadsRemaining: z.number().nullable(),
    })
    .nullable(),
})
export type SmsApprovalQueueItem = z.infer<typeof SmsApprovalQueueItemSchema>

export const SmsApprovalQueueResponseSchema = z.object({
  items: z.array(SmsApprovalQueueItemSchema),
})
export type SmsApprovalQueueResponse = z.infer<
  typeof SmsApprovalQueueResponseSchema
>

// Per-job counters mapped from Peerly's detailedstats read. Null when the
// vendor read failed — the monitor renders what it has.
export const SmsAdminJobStatsSchema = z.object({
  sentTotal: z.number(),
  receivedTotal: z.number(),
  delivered: z.number(),
  deliveryFailed: z.number(),
  deliveryUnconfirmed: z.number(),
  totalCost: z.number(),
})
export type SmsAdminJobStats = z.infer<typeof SmsAdminJobStatsSchema>

export const SmsAdminDetailResponseSchema = z.object({
  item: SmsApprovalQueueItemSchema,
  stats: SmsAdminJobStatsSchema.nullable(),
})
export type SmsAdminDetailResponse = z.infer<
  typeof SmsAdminDetailResponseSchema
>

// The M2M token identifies gp-admin, not the human — the acting admin's
// identity rides in the body. Initials feed Peerly's request_canvassers.
export const ApproveSmsOutreachRequestSchema = z.object({
  approvedBy: z.string().min(1).max(255),
  initials: z
    .string()
    .min(2)
    .max(4)
    .regex(/^[A-Za-z]+$/, 'Initials must be letters only'),
})
export type ApproveSmsOutreachRequest = z.infer<
  typeof ApproveSmsOutreachRequestSchema
>

export const DenySmsOutreachRequestSchema = z.object({
  deniedBy: z.string().min(1).max(255),
  reason: z.string().min(1).max(2000),
})
export type DenySmsOutreachRequest = z.infer<
  typeof DenySmsOutreachRequestSchema
>

// CAS's fix path: staff correct the message in place, then approve. Any
// prior decision (including a denial) is wiped so the approve is a fresh
// call on the edited text.
export const EditSmsOutreachRequestSchema = z.object({
  script: z.string().min(1).max(P2P_SCRIPT_MAX_LENGTH),
  editedBy: z.string().min(1).max(255),
})
export type EditSmsOutreachRequest = z.infer<
  typeof EditSmsOutreachRequestSchema
>

export const SmsTestMessageRequestSchema = z.object({
  // E.164-ish: digits with optional leading +, 10-15 digits.
  phone: z
    .string()
    .regex(/^\+?\d{10,15}$/, 'Use digits only, e.g. +15551234567'),
})
export type SmsTestMessageRequest = z.infer<typeof SmsTestMessageRequestSchema>
