import { z } from 'zod'

export const ComposeHandoffPayloadSchema = z.discriminatedUnion('channel', [
  z.object({
    channel: z.literal('serve_social'),
    draftText: z.string().min(1).max(2000),
    purpose: z.string().max(120).optional(),
  }),
])

export type ComposeHandoffPayload = z.infer<typeof ComposeHandoffPayloadSchema>
