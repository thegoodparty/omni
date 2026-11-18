import { z } from 'zod'
import {
  AgentMessageRoleSchema,
  AgentRunStatusSchema,
} from '../generated/enums'
import { zCoerceDate } from '../shared/Date.schema'
import { PaginationOptionsSchema } from '../shared/Pagination.schema'

// The background agents of `src/agents` in gp-api: one conversation per run,
// no stages. The PMF Engine's `ExperimentRun` is the other, older admin
// surface (`agentRuns/AgentRun.schema.ts`); the two share no columns.
export {
  AGENT_MESSAGE_ROLE_VALUES,
  AgentMessageRoleSchema,
  type AgentMessageRole,
  AGENT_RUN_STATUS_VALUES,
  AgentRunStatusSchema,
  type AgentRunStatus,
} from '../generated/enums'

export const BackgroundAgentRunListItemSchema = z.object({
  runId: z.string(),
  agentName: z.string(),
  organizationSlug: z.string(),
  status: AgentRunStatusSchema,
  // Derived from startedAt/finishedAt at read time; the table stores neither
  // a duration nor a cost.
  durationSeconds: z.number().nullable(),
  createdAt: zCoerceDate(),
})

export type BackgroundAgentRunListItem = z.infer<
  typeof BackgroundAgentRunListItemSchema
>

export const BackgroundAgentRunsListQuerySchema =
  PaginationOptionsSchema.extend({
    agentName: z.string().optional(),
    status: AgentRunStatusSchema.optional(),
    organizationSlug: z.string().optional(),
    createdAfter: zCoerceDate().optional(),
    createdBefore: zCoerceDate().optional(),
  })

export type BackgroundAgentRunsListQuery = z.infer<
  typeof BackgroundAgentRunsListQuerySchema
>

// One AgentMessage row in the AI SDK's message shape. `parts` stays opaque
// here because the parts of a row depend on its role: text and tool calls on
// an assistant row, tool results on a tool row.
export const BackgroundAgentMessageSchema = z.object({
  index: z.number().int(),
  role: AgentMessageRoleSchema,
  parts: z.array(z.unknown()),
  // Only assistant rows are a model call, so only they carry these.
  model: z.string().nullable(),
  inputTokens: z.number().nullable(),
  outputTokens: z.number().nullable(),
  cacheReadTokens: z.number().nullable(),
  cacheWriteTokens: z.number().nullable(),
  createdAt: zCoerceDate(),
})

export type BackgroundAgentMessage = z.infer<
  typeof BackgroundAgentMessageSchema
>

export const BackgroundAgentRunDetailSchema = z.object({
  runId: z.string(),
  agentName: z.string(),
  organizationSlug: z.string(),
  status: AgentRunStatusSchema,
  input: z.record(z.string(), z.unknown()),
  artifact: z.record(z.string(), z.unknown()).nullable(),
  error: z.string().nullable(),
  shapeHash: z.string(),
  durationSeconds: z.number().nullable(),
  createdAt: zCoerceDate(),
  startedAt: zCoerceDate().nullable(),
  finishedAt: zCoerceDate().nullable(),
  messages: z.array(BackgroundAgentMessageSchema),
})

export type BackgroundAgentRunDetail = z.infer<
  typeof BackgroundAgentRunDetailSchema
>
