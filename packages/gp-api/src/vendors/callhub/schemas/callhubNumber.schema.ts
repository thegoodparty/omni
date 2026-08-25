import { z } from 'zod'

// campaign_type must be VOICE_BROADCAST for a robocall caller-ID number (the
// API defaults to CALL_CENTER). phone_number_prefix is a 3-digit area code;
// CallHub silently rents a random national number if that prefix is exhausted,
// so callers must check the returned number's area code against what they asked.
export const CALLHUB_VB_CAMPAIGN_TYPE = 'VOICE_BROADCAST' as const

export const RentNumberRequestSchema = z.object({
  country_iso: z.string(),
  phone_number_prefix: z.string().optional(),
  campaign_type: z.literal(CALLHUB_VB_CAMPAIGN_TYPE),
})
export type RentNumberRequest = z.infer<typeof RentNumberRequestSchema>

// Response fields we consume; CallHub returns more (stripped by z.object).
// `phone_number` is the caller ID we reuse, so it's the identifier here — no
// numeric id is read (CallHub ids exceed JS's safe-integer range).
export const CallhubRentedNumberSchema = z.object({
  phone_number: z.string(),
  country: z.string().nullish(),
  region: z.string().nullish(),
  is_active: z.boolean().nullish(),
  is_used_in_campaign: z.boolean().nullish(),
  api_monthly_rental_charge: z.number().nullish(),
  api_setup_charge: z.number().nullish(),
  provider: z.string().nullish(),
})
export type CallhubRentedNumber = z.infer<typeof CallhubRentedNumberSchema>

// GET /v1/numbers/rented_calling_numbers/ — standard DRF page envelope.
export const RentedNumbersPageSchema = z.object({
  count: z.number(),
  next: z.string().nullable(),
  previous: z.string().nullable(),
  results: z.array(CallhubRentedNumberSchema),
})
export type RentedNumbersPage = z.infer<typeof RentedNumbersPageSchema>
