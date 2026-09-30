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
// `peerly_approved` means the vendor's own review confirmed it; `canceled`
// rows stay visible for the audit trail (who ended the send, and when);
// `sent` is a booked send whose send day has passed (the spine's
// `completed`) — a record of what went out, not a delivery confirmation.
export const SMS_APPROVAL_STATUS_VALUES = [
  'awaiting_review',
  'denied',
  'canvass_requested',
  'peerly_approved',
  'sent',
  'canceled',
] as const
export const SmsApprovalStatusSchema = z.enum(SMS_APPROVAL_STATUS_VALUES)
export type SmsApprovalStatus = z.infer<typeof SmsApprovalStatusSchema>

// Deterministic message-standards checks (the compliance half of the
// brief's Proposal B). The rule set is the CAS compliance list confirmed
// 2026-09-02: opt-out text, recipient name, candidate name, and the
// "Paid for by <committee>" disclaimer. Rule ids are stable identifiers
// the UI maps to copy.
//
// `link_shortener` is the one rule that is not a CAS preference but a hard
// vendor/carrier refusal, and it lives here because this checker is the only
// thing that runs BEFORE checkout. Peerly rejects a job whose template
// carries a public shortener with a 400 naming the domain ("Message cannot
// contain bit.ly links."), and it only sees the template at job creation —
// which on the draft-first flow happens after Stripe has captured payment.
// A candidate paid $634.10 for a send that could never be created that way
// (campaign 325980, 2026-09-30); refusing the draft is the only place the
// answer is free.
export const SMS_STANDARDS_RULE_VALUES = [
  'opt_out_line',
  'first_name_token',
  'candidate_name',
  'paid_for_by',
  'length',
  'link_shortener',
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

// Public URL shorteners 10DLC carriers refuse to deliver, and with them
// Peerly. Deliberately only well-known shortening services: a domain missing
// from this list fails the way it does today (at the vendor, after payment),
// while a domain wrongly on it would block a message Peerly would have
// accepted. Extend it when Peerly names a domain we do not carry.
export const LINK_SHORTENER_DOMAINS = [
  'bit.ly',
  'bitly.com',
  'tinyurl.com',
  'goo.gl',
  't.co',
  'ow.ly',
  'is.gd',
  'buff.ly',
  'rebrand.ly',
  'cutt.ly',
  'shorturl.at',
  'tiny.cc',
  'rb.gy',
  'lnkd.in',
  't.ly',
  'v.gd',
  'bl.ink',
  'trib.al',
  'snip.ly',
  's.id',
] as const

// The leading boundary excludes a label that merely ends in the domain
// ("orbit.ly") while still matching a subdomain form ("www.bit.ly"); the
// trailing one excludes a longer label ("bit.lyrics") while allowing a path,
// a trailing slash, or a sentence-ending period.
const LINK_SHORTENER_PATTERN = new RegExp(
  `(?:^|[^a-z0-9-])(?:${LINK_SHORTENER_DOMAINS.map((domain) =>
    domain.replace(/\./g, '\\.'),
  ).join('|')})(?![a-z0-9-])`,
  'i',
)

// Which shortener a message carries, or null. Exported so a caller can name
// the domain back to the candidate instead of describing the rule.
export const findLinkShortener = (script: string): string | null => {
  const match = LINK_SHORTENER_PATTERN.exec(script)
  if (!match) return null
  return match[0].replace(/^[^a-z0-9]+/i, '').toLowerCase()
}

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
  if (findLinkShortener(script)) {
    failures.push('link_shortener')
  }

  return { passed: failures.length === 0, failures }
}

export const SmsApprovalQueueItemSchema = z.object({
  id: z.number(),
  campaignId: z.number(),
  campaignSlug: z.string(),
  candidateName: z.string().nullable(),
  // The HubSpot company owner (the campaign's assigned success person),
  // resolved best-effort at read time; null when unassigned or the CRM
  // read failed.
  assignedPa: z.string().nullable(),
  name: z.string().nullable(),
  createdAt: zCoerceDate(),
  sendAt: zCoerceDate().nullable(),
  scheduledLocalDate: z.string().nullable(),
  // The candidate's chosen wall-clock send time ("HH:mm"), applied in each
  // contact's local timezone as the Peerly window start at approve. Null on
  // rows created before the field existed (approve falls back to 09:00).
  scheduledLocalTime: z.string().nullable(),
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
  canceledAt: zCoerceDate().nullable(),
  canceledBy: z.string().nullable(),
  canceledByAdmin: z.boolean(),
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
// identity rides in the body. Peerly's request_canvassers initials are
// derived server-side from the Peerly API login (the vendor validates
// them against the requesting user), so they don't ride here.
export const ApproveSmsOutreachRequestSchema = z.object({
  approvedBy: z.string().min(1).max(255),
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

// Admin cancel runs the same unwind as the candidate's (vendor job
// deleted, refund, promo restore) and additionally records who ended it.
export const CancelSmsOutreachRequestSchema = z.object({
  canceledBy: z.string().min(1).max(255),
})
export type CancelSmsOutreachRequest = z.infer<
  typeof CancelSmsOutreachRequestSchema
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

// Staff reschedule: both fields derive from one picker — sendAt is the
// instant, scheduledLocalDate the calendar day Peerly's job window and
// canvasser booking use. Coherence is validated loosely (the day is the
// picker's own reading of the same choice); the future-send check lives
// server-side where "now" is authoritative.
export const EditSmsOutreachDateRequestSchema = z.object({
  sendAt: zCoerceDate(),
  scheduledLocalDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use yyyy-MM-dd')
    .refine(
      (value) => !Number.isNaN(Date.parse(value)),
      'Not a real calendar day',
    ),
  editedBy: z.string().min(1).max(255),
})
export type EditSmsOutreachDateRequest = z.infer<
  typeof EditSmsOutreachDateRequestSchema
>

export const SmsTestMessageRequestSchema = z.object({
  // E.164-ish: digits with optional leading +, 10-15 digits.
  phone: z
    .string()
    .regex(/^\+?\d{10,15}$/, 'Use digits only, e.g. +15551234567'),
})
export type SmsTestMessageRequest = z.infer<typeof SmsTestMessageRequestSchema>

export const SmsTestMessageResponseSchema = z.object({
  sent: z.boolean(),
})
export type SmsTestMessageResponse = z.infer<
  typeof SmsTestMessageResponseSchema
>
