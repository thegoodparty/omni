import {
  MAX_PAGE,
  MAX_PAGINATION_OFFSET,
  MAX_RESULTS_PER_PAGE,
} from '@goodparty_org/contracts'
import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'

export const listContactsSchema = z
  .object({
    // Bounded so a single request can't extract an entire district/state of
    // restricted voter data (or OOM the shared people-api). people-api enforces
    // the same caps (shared via contracts) as the last line of defense; page is
    // also bounded so a huge page can't force a negative or enormous OFFSET.
    resultsPerPage: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_RESULTS_PER_PAGE)
      .optional()
      .default(50),
    page: z.coerce.number().int().min(1).max(MAX_PAGE).optional().default(1),
    search: z.string().optional(),
    segment: z.string().optional(),
  })
  // Cap the effective SQL OFFSET ((page - 1) * resultsPerPage): the per-field
  // caps alone still permit a multi-hundred-million-row OFFSET.
  .refine(
    ({ page, resultsPerPage }) =>
      (page - 1) * resultsPerPage <= MAX_PAGINATION_OFFSET,
    {
      message: `Pagination offset (page × resultsPerPage) may not exceed ${MAX_PAGINATION_OFFSET}`,
      path: ['page'],
    },
  )

const downloadContactsSchema = z.object({
  segment: z.string().optional(),
})

export class ListContactsDTO extends createZodDto(listContactsSchema) {}
export class DownloadContactsDTO extends createZodDto(downloadContactsSchema) {}
