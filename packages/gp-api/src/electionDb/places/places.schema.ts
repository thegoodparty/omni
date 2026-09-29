import { Prisma } from '@/generated/election-prisma'
import { createZodDto } from 'nestjs-zod'
import { STATE_CODES } from '@goodparty_org/nest-common'
import { z } from 'zod'

export const placeColumns = Object.values(
  Prisma.PlaceScalarFieldEnum,
) as (keyof typeof Prisma.PlaceScalarFieldEnum)[]
const raceColumns = Object.values(
  Prisma.RaceScalarFieldEnum,
) as (keyof typeof Prisma.RaceScalarFieldEnum)[]

const toUpper = (val: unknown) =>
  typeof val === 'string' ? val.toUpperCase() : val

// The last collection endpoint without a bound: `?state=TX` could pull every
// place in a state with children, parents and races eagerly loaded. Same fix
// as candidacies, officeholders and persons.
export const DEFAULT_PLACE_PAGE_SIZE = 1000
export const MAX_PLACE_PAGE_SIZE = 5000

const placeFilterSchema = z.object({
  state: z
    .preprocess(toUpper, z.string())
    .optional()
    .refine((val) => {
      if (!val) return true
      return STATE_CODES.includes(val)
    }, 'Invalid state code'),
  name: z.string().optional(),
  slug: z.string().optional(),
  mtfcc: z.string().optional(),
  includeChildren: z.preprocess(
    (val) => val === 'true' || val === '1' || val === true,
    z.boolean().optional().default(false),
  ),
  includeChildRaces: z.preprocess(
    (val) => val === 'true' || val === '1' || val === true,
    z.boolean().optional().default(false),
  ),
  includeParent: z.preprocess(
    (val) => val === 'true' || val === '1' || val === true,
    z.boolean().optional().default(false),
  ),
  includeRaces: z.preprocess(
    (val) => val === 'true' || val === '1' || val === true,
    z.boolean().optional().default(false),
  ),
  categorizeChildren: z.preprocess(
    (val) => val === 'true' || val === '1' || val === true,
    z.boolean().optional().default(false),
  ),
  placeColumns: z
    .string()
    .optional()
    .refine(
      (val) => {
        if (!val) return true
        const columns = val.split(',').map((col) => col.trim())
        return columns.every((col) =>
          (placeColumns as readonly string[]).includes(col),
        )
      },
      {
        message: `Invalid place column provided. Allowed columns are: ${placeColumns.join(', ')}`,
      },
    ),
  raceColumns: z
    .string()
    .optional()
    .refine(
      (val) => {
        if (!val) return true
        const columns = val.split(',').map((col) => col.trim())
        return columns.every((col) =>
          (raceColumns as readonly string[]).includes(col),
        )
      },
      {
        message: `Invalid race column provided. Allowed columns are: ${raceColumns.join(', ')}`,
      },
    ),
  // Optional, not defaulted: the service applies the default so the bound
  // holds for in-process callers that build the filter directly.
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(MAX_PLACE_PAGE_SIZE).optional(),
})
///  .strict()

// `count` is interpolated into a raw SQL LIMIT, so an unbounded value is the
// same unbounded-scan hazard the paginated endpoints were fixed for. The cap
// is deliberately far above any real caller — the marketing site asks for 3 —
// so it only ever rejects an ask that was never legitimate.
export const MAX_MOST_ELECTIONS_COUNT = 100

const mostElectionsSchema = z.object({
  count: z
    .string()
    .transform(Number)
    .refine(
      (n) => Number.isInteger(n) && n > 0 && n <= MAX_MOST_ELECTIONS_COUNT,
      {
        message: `count must be a positive integer no greater than ${MAX_MOST_ELECTIONS_COUNT}`,
      },
    ),
})

export class PlaceFilterDto extends createZodDto(placeFilterSchema) {}
export class MostElectionsDto extends createZodDto(mostElectionsSchema) {}
