import { z } from 'zod'
import { zCoerceDate } from '../shared/Date.schema'

export const OutreachArchiveRequestSchema = z.object({
  archived: z.boolean(),
})
export type OutreachArchiveRequest = z.infer<
  typeof OutreachArchiveRequestSchema
>

// The response reads from the persisted row, not the request body, so a
// retry can't misreport state.
export const OutreachArchiveResponseSchema = z.object({
  id: z.number(),
  archivedAt: zCoerceDate().nullable(),
})
export type OutreachArchiveResponse = z.infer<
  typeof OutreachArchiveResponseSchema
>
