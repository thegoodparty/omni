import { z } from 'zod'

export const ComposeHandoffPayloadSchema = z.discriminatedUnion('channel', [
  z.object({
    channel: z.literal('serve_social'),
    draftText: z.string().min(1).max(2000),
    purpose: z.string().max(120).optional(),
  }),
  z.object({
    channel: z.literal('win_social'),
    draftText: z.string().min(1).max(2000),
    purpose: z.string().max(120).optional(),
  }),
])

export type ComposeHandoffPayload = z.infer<typeof ComposeHandoffPayloadSchema>

export type ComposeHandoffChannel = ComposeHandoffPayload['channel']

// Anthropic rejects a top-level anyOf (the discriminated union's own JSON
// shape), so each tool must register a single channel's object arm as its
// input schema. This lookup is how a caller picks exactly one without
// hand-indexing `.options`.
export const COMPOSE_HANDOFF_CHANNEL_SCHEMAS = {
  serve_social: ComposeHandoffPayloadSchema.options[0],
  win_social: ComposeHandoffPayloadSchema.options[1],
} as const satisfies Record<ComposeHandoffChannel, z.ZodTypeAny>
