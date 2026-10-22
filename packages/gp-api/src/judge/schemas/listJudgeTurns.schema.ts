import { zDate } from '@goodparty_org/contracts'
import { z } from 'zod'

export const JudgeToolStepSchema = z.object({
  toolCallId: z.string(),
  name: z.string(),
})

export const JudgeToolStepsSchema = z.array(JudgeToolStepSchema)
export const JudgeToolQueriesSchema = z.array(z.string())

// `model`, `inputTokens` and `outputTokens` are joined from the assistant
// ChatMessage rather than stored on the telemetry row, so a turn's spend can
// never be reported from two copies that disagree. All three are null for a
// turn that persisted no assistant row, and for one whose usage never
// resolved.
export const JudgeTurnSchema = z.object({
  sweepId: z.string(),
  turnIndex: z.number().int(),
  assistantMessageId: z.string().nullable(),
  promptHash: z.string(),
  promptHashVersion: z.string(),
  toolNames: z.array(z.string()),
  toolSteps: JudgeToolStepsSchema,
  toolQueries: JudgeToolQueriesSchema,
  dataVersion: z.string().nullable(),
  model: z.string().nullable(),
  inputTokens: z.number().int().nullable(),
  outputTokens: z.number().int().nullable(),
  createdAt: zDate(),
})

export const ListJudgeTurnsResponseSchema = z.object({
  conversationId: z.string(),
  turns: z.array(JudgeTurnSchema),
})

export type JudgeTurn = z.infer<typeof JudgeTurnSchema>
export type ListJudgeTurnsResponse = z.infer<
  typeof ListJudgeTurnsResponseSchema
>
