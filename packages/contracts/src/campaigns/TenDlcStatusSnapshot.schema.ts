import { z } from 'zod'

// The gp-admin 10DLC triage page's bucket taxonomy — the same populations the
// nightly Slack report renders as sections, computed by the same gp-api code
// (Nightly10DlcReportService.collectStatusSnapshot) so the page and the report
// can't drift. Keys are ordered failure buckets first, nudge buckets last.
export const TenDlcStatusBucketKeySchema = z.enum([
  'stuckSubmission',
  'kickoffError',
  'rejected',
  'billingBlocked',
  'domainPurchaseIncomplete',
  'domainNotResolving',
  'cvInReviewStalled',
  'finalizeStalled',
  'dispatchDeferred',
  'awaitingPin',
  'cvUnissued',
])

export type TenDlcStatusBucketKey = z.infer<typeof TenDlcStatusBucketKeySchema>

// One stuck registration. The shape is flat across buckets: `since` is the
// bucket's own clock (the same one the nightly report ages from — never
// `updatedAt`), and the nullable context fields are populated only where the
// bucket has them (domain buckets carry domainName, escalation buckets carry
// escalatedAt, and so on).
export const TenDlcStatusEntrySchema = z.object({
  campaignId: z.number().int(),
  campaignSlug: z.string(),
  userId: z.number().int(),
  committeeName: z.string().nullable(),
  peerlyIdentityId: z.string().nullable(),
  filingUrl: z.string().nullable(),
  since: z.string().datetime({ offset: true }).nullable(),
  agenticRunId: z.string().nullable(),
  runStatus: z.string().nullable(),
  domainName: z.string().nullable(),
  domainStatus: z.string().nullable(),
  escalatedAt: z.string().datetime({ offset: true }).nullable(),
  peerlyCvStatus: z.string().nullable(),
  // Set when the record is held by the CV pre-submission validation gate —
  // the admin override-and-resubmit action applies to exactly these rows.
  cvValidationFailedAt: z.string().datetime({ offset: true }).nullable(),
  // dispatchDeferred only: the campaign has no user association, so the fix
  // is a data repair, not a candidate nudge.
  missingUser: z.boolean(),
})

export type TenDlcStatusEntry = z.infer<typeof TenDlcStatusEntrySchema>

export const TenDlcStatusBucketSchema = z.object({
  key: TenDlcStatusBucketKeySchema,
  entries: z.array(TenDlcStatusEntrySchema),
})

export type TenDlcStatusBucket = z.infer<typeof TenDlcStatusBucketSchema>

// Every bucket is always present (possibly empty) in taxonomy order, so the
// page's summary header never has to special-case a missing key.
export const TenDlcStatusSnapshotSchema = z.object({
  generatedAt: z.string().datetime({ offset: true }),
  buckets: z.array(TenDlcStatusBucketSchema),
})

export type TenDlcStatusSnapshot = z.infer<typeof TenDlcStatusSnapshotSchema>
