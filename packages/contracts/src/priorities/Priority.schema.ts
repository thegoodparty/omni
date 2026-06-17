import { z } from 'zod'
import { PrioritySourceSchema } from '../generated/enums'

export const PrioritySchema = z.object({
  id: z.string(),
  electedOfficeId: z.string(),
  title: z.string(),
  description: z.string(),
  source: PrioritySourceSchema,
  sourceCampaignPositionId: z.number().int().nullable(),
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
  targetDate: z.string().date().nullish(),
})

export type UpdatePriorityInput = z.infer<typeof UpdatePriorityInputSchema>
