// Vendor-neutral shapes for the robocall send chain. None of these reference a
// concrete vendor type (no CallHub pk_str, no CallFire id) so the send/staging
// services can depend on the port instead of a vendor's classes.

// The neutral broadcast lifecycle the send/completion state machines switch on.
// REPLACES the raw CallHub integer CALLHUB_VB_STATUS the code currently reads:
// each adapter maps its vendor's native status into one of these. `unknown` is
// the deliberate fallback for a status an adapter can't classify (a lost read,
// an unmapped code) — callers treat it as "not yet resolved", never as a
// terminal state.
export const ROBOCALL_BROADCAST_STATUS = {
  PENDING: 'pending',
  DIALING: 'dialing',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  ABORTED: 'aborted',
  UNKNOWN: 'unknown',
} as const

export type RobocallBroadcastStatus =
  (typeof ROBOCALL_BROADCAST_STATUS)[keyof typeof ROBOCALL_BROADCAST_STATUS]

export interface RentNumberInput {
  // 3-digit area code to try; a vendor may fall back to a random national
  // number if that prefix is exhausted, so callers verify the returned number.
  areaCode?: string
}

export interface RentedNumber {
  phoneNumber: string
  region: string | null
}

export interface UploadMediaInput {
  file: Buffer
  fileName: string
  mimeType: string
}

export interface UploadedMedia {
  mediaId: string
}

export interface LoadAudienceInput {
  name: string
  // A hosted CSV of recipients (our presigned S3 GET). The vendor adapter owns
  // the CSV-column mapping; the neutral port never exposes it.
  csvUrl: string
  countryIso: string
}

export interface LoadedAudience {
  // Opaque handle to the loaded recipients (a phonebook/list ref); the send
  // chain passes it back to createBroadcast, never interprets it.
  audienceRef: string
  loadedCount: number
}

export interface CreateBroadcastInput {
  name: string
  audienceRef: string
  callerId: string
  mediaId: string
  // When the broadcast should start dialing. A create is always scheduled,
  // never immediate — createBroadcast produces a NON-DIALING campaign.
  scheduledStart: Date
}

export interface CreatedBroadcast {
  // Opaque handle to the created campaign; launch/abort/status address it.
  campaignRef: string
  startingDate: Date
  expirationDate: Date
}

export interface CompletedCount {
  // Dialed/connected calls — the billable count the capture slice charges.
  connectedCount: number
  // Billable seconds, carried for cross-checking; null if the vendor omits it.
  billableSeconds: number | null
}

export interface DncPartition {
  callable: string[]
  dnc: string[]
}
