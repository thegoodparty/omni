import type { TenDlcStatusBucketKey } from '@goodparty_org/sdk'

export interface BucketMeta {
  label: string
  // Tone drives the badge color AND the stuck count. red (broken on our
  // side) and amber (escalated to Peerly, waiting on the vendor) both count
  // as stuck — the nightly report's "N stuck" header counts its two
  // vendor-escalation mirror sections the same way, and the page must match
  // the report. gray = candidate-side nudge, reported but never counted.
  tone: 'red' | 'amber' | 'gray'
  hint: string
}

export const BUCKET_META: Record<TenDlcStatusBucketKey, BucketMeta> = {
  stuckSubmission: {
    label: 'Submission never completed (>24h after kickoff)',
    tone: 'red',
    hint: 'Every automated retry has finished. Rows with a CV validation hold can be overridden and resubmitted from here.',
  },
  kickoffError: {
    label: 'Kickoff rejected',
    tone: 'red',
    hint: 'The agent kickoff was rejected (bad election date or no address source). Fix the campaign data from the user page.',
  },
  rejected: {
    label: 'Rejected by Peerly/CampaignVerify',
    tone: 'red',
    hint: 'Needs a data repair. With no Peerly identity: correct the data, then reset the status. With an identity: escalate to Peerly to withdraw/recreate the CV request.',
  },
  billingBlocked: {
    label: 'Peerly billing block active',
    tone: 'red',
    hint: 'Peerly reported no payment method. Submissions are held for the cooldown; check the vendor account.',
  },
  domainPurchaseIncomplete: {
    label: 'Domain purchase never completed',
    tone: 'red',
    hint: 'The registrar purchase never registrant-verified, so the site cannot go live.',
  },
  domainNotResolving: {
    label: 'Domain not resolving (registry hold?)',
    tone: 'red',
    hint: 'Bought and published, but no DNS delegation. Run whois to check for serverHold; if held, file at the Radix unsuspension portal.',
  },
  cvInReviewStalled: {
    label: 'CV IN_REVIEW >3 business days',
    tone: 'amber',
    hint: 'Escalated to Peerly through the shared channel (weekdays 11am ET). Nothing to do on our side unless Peerly asks.',
  },
  finalizeStalled: {
    label: 'waiting_to_finalize >3 business days',
    tone: 'amber',
    hint: 'The brand is waiting on Peerly to confirm the finalize step. Escalated to Peerly through the shared channel.',
  },
  dispatchDeferred: {
    label: 'Dispatch deferred: candidate profile incomplete',
    tone: 'gray',
    hint: 'The dispatch gate is waiting on a genuine bio and policy issue. The sweep dispatches automatically once the candidate authors one.',
  },
  awaitingPin: {
    label: 'Awaiting PIN >7d (candidate nudge)',
    tone: 'gray',
    hint: 'The PIN is out but was never entered. Nudge the candidate, or resend the PIN from here.',
  },
  cvUnissued: {
    label: 'CampaignVerify still reviewing (no PIN issued)',
    tone: 'gray',
    hint: 'No PIN exists yet, so do not nudge the candidate — they would land on a PIN box they cannot satisfy.',
  },
}

// The same populations the nightly report counts in its "N stuck" header:
// every failure section including the two Peerly-escalation mirrors (amber
// here), never the gray nudge sections. Derived from the tone so a new
// bucket can't join the meta table without also landing in (or out of) the
// count.
export const STUCK_BUCKET_KEYS: TenDlcStatusBucketKey[] = (
  Object.keys(BUCKET_META) as TenDlcStatusBucketKey[]
).filter((key) => BUCKET_META[key].tone !== 'gray')

export const RADIX_UNSUSPENSION_URL = 'https://abuse.radix.website/unsuspension'

// Chart/mark fills for each tone. Same hues as the Badge colors the page
// already uses, so a bucket keeps one color everywhere; slate (not pure
// gray) for the nudge tone so it still reads as a deliberate mark.
export const TONE_FILL: Record<BucketMeta['tone'], string> = {
  red: 'var(--red-9)',
  amber: 'var(--amber-9)',
  gray: 'var(--slate-8)',
}

export const TONE_LABEL: Record<BucketMeta['tone'], string> = {
  red: 'Broken on our side',
  amber: 'Waiting on Peerly',
  gray: 'Waiting on the candidate',
}

export const ALL_BUCKET_KEYS = Object.keys(
  BUCKET_META
) as TenDlcStatusBucketKey[]
