import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'

// Per-page cap on the merge feed. gp-api drains the backlog by paging, so this
// bounds one query rather than one sync.
const MAX_PAGE_SIZE = 1000
const DEFAULT_PAGE_SIZE = 500

// Keyset pagination over (retiredAt, retiredId).
//
// A plain `?since=<timestamp>` cursor is not safe here, and the reason is
// specific to how these rows are produced: one ETL run publishes a whole batch
// of merges, and every row in it can carry an identical `retired_at`. With a
// strict `>` cursor a consumer that stopped mid-batch would skip the rest of
// that timestamp forever; with `>=` it would re-read the boundary row on every
// poll, and a batch larger than one page would never advance at all.
//
// So the cursor is the full sort key. `sinceId` is the last retiredId the
// consumer processed at `since`, and the query resumes strictly after that
// pair. Omitting `sinceId` starts at the beginning of `since` inclusively,
// which is what a first poll (or a deliberate replay) wants.
export const personMergeFilterSchema = z
  .object({
    since: z.iso
      .datetime({ offset: true, message: 'since must be an ISO 8601 datetime' })
      .optional(),
    sinceId: z.guid('sinceId must be a valid UUID').optional(),
    limit: z.coerce
      .number()
      .int()
      .positive()
      .max(MAX_PAGE_SIZE)
      .optional()
      .default(DEFAULT_PAGE_SIZE),
  })
  .strict()
  // sinceId only means anything as a tiebreak within a timestamp; accepting it
  // alone would silently ignore it and hand back a page the consumer thinks it
  // has already seen.
  .refine((val) => !val.sinceId || val.since, {
    message: 'sinceId requires since',
    path: ['sinceId'],
  })

export const getPersonMergeParamsSchema = z.object({
  retiredId: z.guid('retiredId must be a valid UUID'),
})

export class PersonMergeFilterDto extends createZodDto(
  personMergeFilterSchema,
) {}
export class GetPersonMergeParamsDTO extends createZodDto(
  getPersonMergeParamsSchema,
) {}
