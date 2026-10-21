import { IssueTagStatusSchema } from '@goodparty_org/contracts'
import { z } from 'zod'

export const ListIssueTagsQuerySchema = z
  .object({
    status: IssueTagStatusSchema.optional(),
  })
  .strict()

export type ListIssueTagsQuery = z.infer<typeof ListIssueTagsQuerySchema>
