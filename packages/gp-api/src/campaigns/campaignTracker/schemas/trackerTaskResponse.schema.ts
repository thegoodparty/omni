import { z } from 'zod'

// Response shape for GET /campaigns/tracker-tasks. Mirrors the
// CampaignTrackerTask Prisma model the endpoint returns (raw rows from
// findMany), so it doubles as the MCP tool's output schema. Dates use
// z.coerce.date() because the interceptor validates the raw value (Date
// objects) before Fastify serializes them.
export const CampaignTrackerTaskResponseSchema = z.object({
  id: z.string(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  title: z.string(),
  description: z.string(),
  cta: z.string().nullable(),
  flowType: z.string().nullable(),
  week: z.number().int(),
  date: z.coerce.date(),
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
