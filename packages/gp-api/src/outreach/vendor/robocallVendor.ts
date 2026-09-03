import {
  CompletedCount,
  CreateBroadcastInput,
  CreatedBroadcast,
  DncPartition,
  LoadAudienceInput,
  LoadedAudience,
  RentNumberInput,
  RentedNumber,
  RobocallBroadcastStatus,
  UploadMediaInput,
  UploadedMedia,
} from './robocallVendor.types'

// The robocall vendor seam: the operations the send chain needs, in
// vendor-neutral terms. The send/staging/completion services depend on THIS
// interface (via the ROBOCALL_VENDOR token) instead of CallHub's concrete
// classes, so swapping to CallFire is a DI binding change, not a rewrite. A
// permanent, non-retryable failure surfaces as VendorPermanentError (a 502
// subclass) so the money-relevant fail-vs-retry branch stays vendor-agnostic.
export interface RobocallVendor {
  // Rents a reusable caller-ID number (a recurring charge — rent once per
  // candidate and reuse).
  rentNumber(input: RentNumberInput): Promise<RentedNumber>

  // Uploads the pre-recorded audio the broadcast plays on pickup.
  uploadMedia(input: UploadMediaInput): Promise<UploadedMedia>

  // Loads the recipients and returns an opaque handle for createBroadcast.
  loadAudience(input: LoadAudienceInput): Promise<LoadedAudience>

  // Creates a scheduled, NON-DIALING campaign; launchBroadcast is what dials.
  createBroadcast(input: CreateBroadcastInput): Promise<CreatedBroadcast>

  // The dial trigger — the only step that places real calls.
  launchBroadcast(campaignRef: string): Promise<void>

  abortBroadcast(campaignRef: string): Promise<void>

  getBroadcastStatus(campaignRef: string): Promise<RobocallBroadcastStatus>

  // The per-campaign billable/connected count, read after a run completes.
  getCompletedCount(campaignRef: string): Promise<CompletedCount>

  // Splits numbers into callable vs account-DNC-suppressed.
  partitionByDnc(numbers: string[]): Promise<DncPartition>
}

// DI token used to bind and inject the active RobocallVendor implementation.
export const ROBOCALL_VENDOR = Symbol.for('RobocallVendor')
