import { z } from 'zod'

// Response of POST /v1/outreach/robocall/save-card-intent: a Stripe SetupIntent
// client secret the pay-step mounts a Payment Element against to vault the
// candidate's card off-session for the later robocall charge, plus the Stripe
// customerId the card is saved on.
export const RobocallSaveCardIntentResponseSchema = z.object({
  clientSecret: z.string(),
  customerId: z.string(),
})
export type RobocallSaveCardIntentResponse = z.infer<
  typeof RobocallSaveCardIntentResponseSchema
>
