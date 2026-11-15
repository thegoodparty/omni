import { z } from 'zod'

// The public (no login) pages behind the links in outreach email. Mode is
// there so the page can use the right nouns for a campaign or an office.
export const EmailPublicModeSchema = z.enum(['win', 'serve'])
export type EmailPublicMode = z.infer<typeof EmailPublicModeSchema>

export const EmailTokenRequestSchema = z.object({ token: z.string().min(1) })
export type EmailTokenRequest = z.infer<typeof EmailTokenRequestSchema>

export const EmailUnsubscribeStateSchema = z.object({
  senderName: z.string(),
  mode: EmailPublicModeSchema,
  unsubscribed: z.boolean(),
})
export type EmailUnsubscribeState = z.infer<typeof EmailUnsubscribeStateSchema>

export const EmailForwardConfirmStateSchema = z.object({
  senderName: z.string(),
  forwardToEmail: z.string(),
})
export type EmailForwardConfirmState = z.infer<
  typeof EmailForwardConfirmStateSchema
>
