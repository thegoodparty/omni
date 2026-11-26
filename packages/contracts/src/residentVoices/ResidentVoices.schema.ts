import { z } from 'zod'

// What residents of the office's district have said about local matters, for
// the map on the Serve welcome (GET /v1/resident-voices). Nothing about who
// said it, where it was said or what it is about crosses to the browser: the
// words, a point already fuzzed at the source, and whether the comment was
// synthesized, which the map has to say under itself.

// The most the map shows, and the number of synthesized comments a district
// with no real ones carries.
export const RESIDENT_VOICES_MAX = 6

export const ResidentVoiceSchema = z.object({
  id: z.string(),
  quote: z.string(),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  synthetic: z.boolean(),
})
export type ResidentVoice = z.infer<typeof ResidentVoiceSchema>

// Real comments first, then synthesized ones to fill. Empty when the district
// has none or they could not be read, and the map is then skipped.
// `syntheticCount` is how many of `voices` are synthesized.
export const ResidentVoicesResponseSchema = z.object({
  voices: z.array(ResidentVoiceSchema).max(RESIDENT_VOICES_MAX),
  syntheticCount: z.number().int().nonnegative(),
})
export type ResidentVoicesResponse = z.infer<
  typeof ResidentVoicesResponseSchema
>
