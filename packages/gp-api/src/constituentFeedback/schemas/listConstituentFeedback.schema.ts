import { z } from 'zod'

export const ListConstituentFeedbackQuerySchema = z
  .object({
    personId: z.string().min(1),
  })
  .strict()

export type ListConstituentFeedbackQuery = z.infer<
  typeof ListConstituentFeedbackQuerySchema
>
