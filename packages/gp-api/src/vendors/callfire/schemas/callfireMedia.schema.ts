import { z } from 'zod'

// Audio formats CallFire accepts at POST /campaigns/sounds/files (mp3/wav).
export const CALLFIRE_SOUND_MIME_TYPES = [
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
] as const

// CampaignSound response. `id` is the broadcast sound id, typed by CallFire as
// an int64 that exceeds JS's safe-integer range, so it is kept as a STRING
// (mirrors CallHub's id handling). Only the id is consumed downstream.
export const CallfireCampaignSoundSchema = z.object({
  id: z.coerce.string(),
  name: z.string().nullish(),
  lengthInSeconds: z.number().nullish(),
  status: z.string().nullish(),
  duplicate: z.boolean().nullish(),
})
export type CallfireCampaignSound = z.infer<typeof CallfireCampaignSoundSchema>
