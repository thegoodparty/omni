import { z } from 'zod'
import { zCoerceDate } from '@goodparty_org/contracts'

// Response shape for GET /campaigns/tracker-tasks. Mirrors the
// CampaignTrackerTask Prisma model the endpoint returns (raw rows from
// findMany), so it doubles as the MCP tool's output schema. Dates use
// zCoerceDate() because the interceptor validates the raw value (Date
// objects) before Fastify serializes them.
export const CampaignTrackerTaskResponseSchema = z.object({
  id: z.string(),
  createdAt: zCoerceDate(),
  updatedAt: zCoerceDate(),
  title: z.string(),
  description: z.string(),
  cta: z.string().nullable(),
  flowType: z.string().nullable(),
  week: z.number().int(),
  date: zCoerceDate(),
  link: z.string().nullable(),
  proRequired: z.boolean().nullable(),
  isDefaultTask: z.boolean().nullable(),
  deadline: z.number().int().nullable(),
  defaultAiTemplateId: z.string().nullable(),
  completed: z.boolean(),
  phase: z.string().nullable(),
  campaignId: z.number().int(),
  updateHistoryId: z.number().int().nullable(),
})
