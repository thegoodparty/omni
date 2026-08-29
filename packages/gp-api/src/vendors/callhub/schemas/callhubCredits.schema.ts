import { z } from 'zod'

// CallHub's per-campaign-type usage read: POST /v2/credits_usage/. Scoped to a
// single voice-broadcast campaign by `campaign_id` (a STRING — CallHub ids
// exceed JS's safe-integer range, so it is never coerced to a number; DRF
// coerces it server-side). `campaign_type` selects the product: 6 is voice.
export const CALLHUB_CAMPAIGN_TYPE_VOICE = 6

// The usage figures a completed voice broadcast reports. `voice_calls` is the
// number of DIALED calls — the billable/completed count the capture slice
// charges; `voice_billsec` is the billable seconds, carried for cross-checking.
// Both nullish: this shape is docs-derived and UNVERIFIED against a real
// completed run (the account has no completed VB campaign, and one is not
// created here — that would dial real phones). Verify the field mapping against
// a real run before the capture slice relies on it.
export const VoiceCreditsUsageSchema = z.object({
  voice_calls: z.number().int().nullish(),
  voice_billsec: z.number().nullish(),
})
export type VoiceCreditsUsage = z.infer<typeof VoiceCreditsUsageSchema>
