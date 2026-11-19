import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'

// A run's input, in the terms of whichever engine runs it: gp-api's own agent
// validates it against its Zod input schema, the PMF Engine against the
// published manifest's input_schema. Either way it names its organization, and
// that organization is the one the caller must belong to.
export const AgentRunInputSchema = z.record(z.string(), z.json())
export type AgentRunInput = z.infer<typeof AgentRunInputSchema>

export const StartAgentRunRequestSchema = z.object({
  input: AgentRunInputSchema,
})

export class StartAgentRunRequestDto extends createZodDto(
  StartAgentRunRequestSchema,
) {}

export const StartAgentRunResponseSchema = z.object({
  runId: z.string(),
})

// One status vocabulary over both engines' tables. The PMF Engine's
// AWAITING_RESUME reads as failed, because a judge run is never resumed (see
// `AWAITING_RESUME_ERROR` in the service).
export const AGENT_RUN_ROUTE_STATUSES = [
  'queued',
  'running',
  'completed',
  'failed',
  'superseded',
] as const

export type AgentRunRouteStatus = (typeof AGENT_RUN_ROUTE_STATUSES)[number]

export const AgentRunProgressResponseSchema = z.object({
  status: z.enum(AGENT_RUN_ROUTE_STATUSES),
  artifact: z.json(),
  error: z.string().nullable(),
})
