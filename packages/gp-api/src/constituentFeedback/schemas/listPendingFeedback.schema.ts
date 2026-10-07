import { z } from 'zod'

export const ListPendingFeedbackQuerySchema = z
  .object({
    outreachId: z.coerce.number().int().positive(),
  })
  .strict()

export type ListPendingFeedbackQuery = z.infer<
  typeof ListPendingFeedbackQuerySchema
>
