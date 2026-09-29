import { createZodDto } from 'nestjs-zod'
import { STATE_CODES } from '@goodparty_org/nest-common'
import { toUpper } from '@/electionDb/shared/util/strings.util'
import { z } from 'zod'
import { Prisma } from '@/generated/election-prisma'

export const officeHolderColumns = Object.values(
  Prisma.OfficeHolderScalarFieldEnum,
) as (keyof typeof Prisma.OfficeHolderScalarFieldEnum)[]

// Unbounded before: `?state=TX` (or no filter) could materialize the whole
// table with Position eagerly loaded. Same fix as candidacies and races — a
// generous default so a realistically-filtered caller still gets one page,
// with `page` for anything larger.
export const DEFAULT_OFFICE_HOLDER_PAGE_SIZE = 1000
export const MAX_OFFICE_HOLDER_PAGE_SIZE = 5000

export const officeHolderFilterSchema = z
  .object({
    personId: z.guid('personId must be a valid UUID').optional(),
    positionId: z.guid('positionId must be a valid UUID').optional(),
    // BallotReady geo id (OfficeHolder.geoId). Powers "Nearby Officials": other
    // office holders whose constituency shares the same approximate geography.
    geoId: z.string().optional(),
    state: z
      .preprocess(toUpper, z.string())
      .optional()
      .refine((val) => {
        if (!val) return true
        return STATE_CODES.includes(val)
      }, 'Invalid state code'),
    isCurrent: z.coerce.boolean().optional(),
    includePosition: z.coerce.boolean().optional().default(false),
    columns: z
      .string()
      .optional()
      .refine(
        (val) => {
          if (!val) return true
          const columns = val.split(',').map((col) => col.trim())
          return columns.every((col) =>
            (officeHolderColumns as readonly string[]).includes(col),
          )
        },
        {
          message: `Invalid officeHolder column provided. Allowed columns are: ${officeHolderColumns.join(', ')}`,
        },
      ),
    // Optional, not defaulted: the service applies the default so the bound
    // holds for in-process callers that build the filter directly, and there
    // is one place to reason about it. The max still rejects an oversized ask.
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_OFFICE_HOLDER_PAGE_SIZE)
      .optional(),
  })
  .strict()

export class OfficeHolderFilterDto extends createZodDto(
  officeHolderFilterSchema,
) {}
