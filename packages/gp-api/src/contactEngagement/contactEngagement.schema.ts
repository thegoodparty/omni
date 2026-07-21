import { createZodDto } from 'nestjs-zod'
import z from 'zod'

const individualActivityParamsSchema = z.object({
  id: z.string(),
})

const individualActivityQuerySchema = z.object({
  take: z.coerce.number().int().min(1).max(20).optional().default(20),
  after: z.string().optional(), // Last-seen activity's sort-key value (date)
  // Win-only sunset param: brings legacy VoterOutreachActivity rows (keyed on
  // the durable lalVoterId) into the union. Absent for Serve, and absent for
  // Win once the ContactInteraction* backfill is complete.
  lalVoterId: z.string().optional(),
})

export class IndividualActivityParamsDTO extends createZodDto(
  individualActivityParamsSchema,
) {}

export class IndividualActivityQueryDTO extends createZodDto(
  individualActivityQuerySchema,
) {}

export type IndividualActivityInput = {
  personId: string
  organizationSlug: string
  electedOfficeId?: string
  campaignId?: number
} & z.infer<typeof individualActivityQuerySchema>

const constituentIssuesParamsSchema = z.object({
  id: z.string(),
})

const constituentIssuesQuerySchema = z.object({
  take: z.coerce.number().int().min(1).max(20).optional().default(3),
  after: z.string().optional(),
})

export class ConstituentIssuesParamsDTO extends createZodDto(
  constituentIssuesParamsSchema,
) {}

export class ConstituentIssuesQueryDTO extends createZodDto(
  constituentIssuesQuerySchema,
) {}
