import { z } from 'zod'
import { PriorityStageSchema, PrioritySourceSchema } from '../generated/enums'

export const PrioritySchema = z.object({
  id: z.string(),
  electedOfficeId: z.string(),
  title: z.string(),
  description: z.string(),
  source: PrioritySourceSchema,
  sourceCampaignPositionId: z.number().int().nullable(),
  // How far along the official is. Null means never asked — a priority can be
  // created by a Win import or by the agent's tool, neither of which asks.
  stage: PriorityStageSchema.nullable(),
  targetDate: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type Priority = z.infer<typeof PrioritySchema>

export const CreatePriorityInputSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  targetDate: z.string().date().nullish(),
})

export type CreatePriorityInput = z.infer<typeof CreatePriorityInputSchema>

export const UpdatePriorityInputSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  stage: PriorityStageSchema.optional(),
  targetDate: z.string().date().nullish(),
})

export type UpdatePriorityInput = z.infer<typeof UpdatePriorityInputSchema>
