import { z } from 'zod'
import { zCoerceDate } from '../shared/Date.schema'
import { P2P_SCRIPT_MAX_LENGTH } from './OutreachScript.const'
import {
  mergeTagToken,
  type MergeTagChannel,
  type MergeTagId,
} from './MergeTag.const'

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
// candidate_name rule only runs when a name to match is supplied, and a
// name with no word of 3+ letters must then appear in full; the
// paid_for_by rule always requires the phrase, and additionally a
// committee token when the committee name is known (every campaign that
// can schedule an SMS has one, per the 10DLC requirement). Advisory in
// the staff queue: the human approval stays the gate.
// Hosts the texting vendor refuses outright: a message carrying one comes back
// as "Message cannot contain bit.ly links. Please correct your message." from
// job creation, which happens AFTER the candidate has been charged — so a
// shortener the vendor was always going to reject cost one candidate $634 and a
// second payment to get the send out (2026-09-30). This list is ours, not the
// vendor's, so it will drift: it covers the shorteners in wide use, and the
// vendor stays the backstop for anything newer.
//
// The host has to sit on its own: any non-word character may precede it (a
// space, but also `link:bit.ly/x`, `here,bit.ly/x`, `end.bit.ly/x`) and a word
// character may not follow it, nor a dot that starts a longer suffix. So `t.co`
// does not match inside `t.com`, `t.co.uk` or `is.gd.example.com`, and `bit.ly`
// does not match inside `mybit.ly` or `rabbit.lyric`. A sentence-ending period
// is still caught, because what follows it is a space, not a letter.
const LINK_SHORTENER_HOSTS = [
  'bit.ly',
  'bitly.com',
  'tinyurl.com',
  't.co',
  'goo.gl',
  'ow.ly',
  'buff.ly',
  'rebrand.ly',
  'is.gd',
  'cutt.ly',
  'shorturl.at',
  'tiny.cc',
  'rb.gy',
  't.ly',
  'snip.ly',
  'tr.im',
  'clck.ru',
] as const

const LINK_SHORTENER_PATTERN = new RegExp(
  `(?:^|[^\\w-])(?:https?://)?(?:www\\.)?(?:${LINK_SHORTENER_HOSTS.map((host) =>
    host.replace(/\./g, '\\.'),
  ).join('|')})(?![\\w-])(?!\\.[a-z])`,
  'i',
)

// A name's words of 3+ letters, in their original case. Whole-word
// matching (`findWords`) is already case-insensitive, and lowercasing first
// is not safe for it: "İ".toLowerCase() is two characters ("i" plus a
// combining dot), so "İlker" lowercased no longer matches "İlker" in a
// script.
const nameWordsOf = (names: (string | null | undefined)[]): string[] =>
  names
    .filter((name): name is string => !!name)
    .flatMap((name) => name.split(/\s+/))
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)

// Lowercased, for the substring checks that compare against a lowercased
// script (the committee half of paid_for_by).
const nameTokensOf = (names: (string | null | undefined)[]): string[] =>
  nameWordsOf(names).map((token) => token.toLowerCase())

export const checkSmsStandards = (
  script: string,
  context: { candidateNames?: string[]; committeeName?: string | null } = {},
): SmsStandardsVerdict => {
  const failures: SmsStandardsRule[] = []
  const lower = script.toLowerCase()

  // Whole word, as the composer's lock matches it (deriveSmsProtectedParts):
  // "reply stoppage" must fail here rather than pass with nothing locked,
  // where the opt-out instruction could then be deleted before the send.
  if (!/reply\s+stop\b/i.test(script)) {
    failures.push('opt_out_line')
  }
  if (!script.includes('{first_name}')) {
    failures.push('first_name_token')
  }
  // Whole words, as the composer's lock finds the name: "chen" inside
  // "kitchen" is not an identification, and a verdict that accepted it
  // would show the rule met with nothing locked to keep it met.
  // The full name first, then its words of 3+ letters, exactly as the lock
  // looks for it. A short name ("Al Bo") has no such words, so it must
  // appear in full: before, it passed this rule with no name in the script.
  const candidateNames = (context.candidateNames ?? [])
    .map((name) => name.trim())
    .filter(Boolean)
  const candidateTokens = nameWordsOf(candidateNames)
  const namesCandidate =
    candidateNames.some((name) => findWords(script, name) !== null) ||
    candidateTokens.some((token) => findWords(script, token) !== null)
  if (candidateNames.length > 0 && !namesCandidate) {
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
  if (LINK_SHORTENER_PATTERN.test(script)) {
    failures.push('link_shortener')
  }

  return { passed: failures.length === 0, failures }
}

// What a composer locks so a message cannot be edited out of compliance:
// for each rule above, the exact text in `script` that satisfies it. It
// lives beside `checkSmsStandards`, takes the same inputs and finds text the
// same way, so a rule change moves the lock and the verdict together.
//
// Each part is the minimum its rule tests for, with one exception: the
// paid-for-by disclaimer is the phrase AND the committee as one unit. A gap
// between them would let wording change what it says ("Paid for by no one
// at Friends of Sarah Chen") while the rule, which only needs both present,
// still passed. Anything a state adds goes after the unit.
//
// A rule the script already fails yields no part: there is nothing to lock,
// and the verdict is what tells the candidate. `length` never yields one:
// it is a count, not text.
export type SmsProtectedPart =
  | {
      rule: 'first_name_token'
      kind: 'token'
      tagId: MergeTagId
      text: string
    }
  | {
      rule: Exclude<SmsStandardsRule, 'first_name_token' | 'length'>
      kind: 'phrase'
      text: string
    }

const escapeRegExp = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Whole words only, unlike the verdict's substring test: locking "chen"
// inside "kitchen" would freeze a word that is not the candidate's name.
// Letter lookarounds rather than `\\b`, which only knows ASCII letters and
// would never match a name like "Élodie".
const findWords = (script: string, words: string): string | null => {
  const match = new RegExp(
    `(?<![\\p{L}\\p{N}])${escapeRegExp(words)}(?![\\p{L}\\p{N}])`,
    'iu',
  ).exec(script)
  return match ? match[0] : null
}

export const deriveSmsProtectedParts = (
  script: string,
  context: {
    candidateNames?: string[]
    committeeName?: string | null
    // Which merge-tag form the send uses: Peerly `{first_name}`, Serve
    // `{{first_name}}`.
    channel?: MergeTagChannel
    // The surface's own `ignoredStandardsRules`; Serve ignores paid_for_by.
    ignoredRules?: readonly SmsStandardsRule[]
  } = {},
): SmsProtectedPart[] => {
  const ignored = new Set(context.ignoredRules ?? [])
  const parts: SmsProtectedPart[] = []

  if (!ignored.has('first_name_token')) {
    const text = mergeTagToken('first_name', context.channel ?? 'peerly')
    if (script.includes(text)) {
      parts.push({
        rule: 'first_name_token',
        kind: 'token',
        tagId: 'first_name',
        text,
      })
    }
  }

  // The disclaimer first, because the committee often carries the
  // candidate's name ("Friends of Sarah Chen"), and the name has to be found
  // outside it: inside, the disclaimer already locks it, and the copy the
  // candidate actually wrote ("it's Sarah") would go unlocked.
  // Found even when the surface ignores paid_for_by (Serve), so the name
  // search still skips it: a name that only appears inside a disclaimer the
  // surface does not enforce must not get locked there. Only the lock itself
  // is gated on the rule.
  let disclaimer: { start: number; text: string } | null = null
  {
    const phrase = /paid\s+for\s+by/i.exec(script)
    if (phrase) {
      const committee = context.committeeName?.trim()
      const after = script.slice(phrase.index + phrase[0].length)
      const named = committee
        ? // Any run of non-letters between them: "Paid for by Friends", "Paid
          // for by: Friends", "Paid for by - Friends" all name the committee.
          new RegExp(`^[^\\p{L}\\p{N}]+${escapeRegExp(committee)}`, 'iu').exec(
            after,
          )
        : null
      disclaimer = {
        start: phrase.index,
        text: phrase[0] + (named ? named[0] : ''),
      }
    }
  }

  if (!ignored.has('candidate_name')) {
    const withoutDisclaimer = disclaimer
      ? script.slice(0, disclaimer.start) +
        ' '.repeat(disclaimer.text.length) +
        script.slice(disclaimer.start + disclaimer.text.length)
      : script
    // Every copy of the committee too, not just one that follows "Paid for
    // by": "Paid for by the committee, Friends of Sarah Chen" leaves the
    // committee outside the unit, and its "Sarah Chen" would otherwise win
    // the full-name match over the candidate's own "it's Sarah".
    //
    // Unless the committee IS the candidate's name ("Sarah Chen" for Sarah
    // Chen): then every copy of it is also the name they wrote, and masking
    // them all would leave nothing to lock.
    const committee = context.committeeName?.trim()
    const committeeIsName = (context.candidateNames ?? []).some(
      (name) => name.trim().toLowerCase() === committee?.toLowerCase(),
    )
    const outside =
      committee && !committeeIsName
        ? withoutDisclaimer.replace(
            new RegExp(escapeRegExp(committee), 'giu'),
            (match) => ' '.repeat(match.length),
          )
        : withoutDisclaimer
    // The full name as written when it is there; otherwise the first of its
    // words the script uses, since scripts often identify by first name.
    const names = (context.candidateNames ?? []).filter(Boolean)
    const text =
      names.map((name) => findWords(outside, name.trim())).find(Boolean) ??
      nameWordsOf(names)
        .map((token) => findWords(outside, token))
        .find(Boolean)
    if (text) parts.push({ rule: 'candidate_name', kind: 'phrase', text })
  }

  if (disclaimer && !ignored.has('paid_for_by')) {
    parts.push({ rule: 'paid_for_by', kind: 'phrase', text: disclaimer.text })
  }

  if (!ignored.has('opt_out_line')) {
    const optOut = /reply\s+stop\b(?:\s+to\s+opt[\s-]?out)?\.?/i.exec(script)
    if (optOut)
      parts.push({ rule: 'opt_out_line', kind: 'phrase', text: optOut[0] })
  }

  return parts
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
