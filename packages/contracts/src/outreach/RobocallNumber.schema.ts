import { z } from 'zod'

// Response of POST /v1/outreach/robocall/number: the rented CallHub caller-ID
// number the candidate reads aloud as the callback number in the recording.
// region is the number's area (e.g. state) when CallHub reports it.
export const RobocallNumberResponseSchema = z.object({
  phoneNumber: z.string(),
  region: z.string().nullish(),
})
export type RobocallNumberResponse = z.infer<
  typeof RobocallNumberResponseSchema
>
