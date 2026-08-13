import { Prisma } from '../generated/prisma'
import { createZodDto } from 'nestjs-zod'
import { candidacyColumns } from 'src/candidacies/candidacies.schema'
import { placeColumns } from 'src/places/places.schema'
import { STATE_CODES } from '@goodparty_org/nest-common'
import { toUpper } from 'src/shared/util/strings.util'
import { z } from 'zod'

export const raceColumns = Object.values(
  Prisma.RaceScalarFieldEnum,
) as (keyof typeof Prisma.RaceScalarFieldEnum)[]

const positionLevelEnum = z.enum([
  'CITY',
  'COUNTY',
  'FEDERAL',
  'LOCAL',
  'REGIONAL',
  'STATE',
  'TOWNSHIP',
])

// `GET /races` historically ran an unbounded `findMany` (no `take`), so a broad
// filter like `?state=TX` could materialize the entire state's race set into
// memory before deduping. `pageSize` bounds that; it counts DISTINCT races
// (post-dedupe slugs), not raw rows. The default is deliberately generous —
// larger than any realistic single-state/level result set — so existing
// (unpaginated) callers keep getting their full result while a pathological
// unfiltered scan is still capped. Callers that need more than one page's
// worth walk pages explicitly via `page`.
export const DEFAULT_RACE_PAGE_SIZE = 1000
export const MAX_RACE_PAGE_SIZE = 5000

export const raceFilterSchema = z
  .object({
    state: z
      .preprocess(toUpper, z.string())
      .optional()
      .refine((val) => {
        if (!val) return true
        return STATE_CODES.includes(val)
      }, 'Invalid state code'),
    placeSlug: z.string().optional(),
    positionLevel: positionLevelEnum.optional(),
    raceSlug: z.string().optional(),
    electionDateStart: z.string().optional(),
    electionDateEnd: z.string().optional(),
    includePlace: z.preprocess(
      (val) => val === 'true' || val === '1' || val === true,
      z.boolean().optional().default(false),
    ),
    includeCandidacies: z.preprocess(
      (val) => val === 'true' || val === '1' || val === true,
      z.boolean().optional().default(false),
    ),
    isPrimary: z.preprocess(
      (val) => val === 'true' || val === '1' || val === true,
      z.boolean().optional(),
    ),
    isRunoff: z.preprocess(
      (val) => val === 'true' || val === '1' || val === true,
      z.boolean().optional(),
    ),
    page: z.coerce.number().int().positive().optional().default(1),
    pageSize: z.coerce
      .number()
      .int()
      .positive()
      .max(MAX_RACE_PAGE_SIZE)
      .optional()
      .default(DEFAULT_RACE_PAGE_SIZE),
    raceColumns: z
      .string()
      .optional()
      .refine(
        (val) => {
          if (!val) return true
          const columns = val.split(',').map((col) => col.trim())
          return columns.every((col) =>
            raceColumns.includes(
              col as keyof typeof Prisma.RaceScalarFieldEnum,
            ),
          )
        },
        {
          message: `Invalid race column provided. Allowed columns are: ${raceColumns.join(', ')}`,
        },
      ),
    placeColumns: z
      .string()
      .optional()
      .refine(
        (val) => {
          if (!val) return true
          const columns = val.split(',').map((col) => col.trim())
          return columns.every((col) =>
            placeColumns.includes(
              col as keyof typeof Prisma.PlaceScalarFieldEnum,
            ),
          )
        },
        {
          message: `Invalid place column provided. Allowed columns are: ${placeColumns.join(', ')}`,
        },
      ),
    candidacyColumns: z
      .string()
      .optional()
      .refine(
        (val) => {
          if (!val) return true
          const columns = val.split(',').map((col) => col.trim())
          return columns.every((col) =>
            candidacyColumns.includes(
              col as keyof typeof Prisma.CandidacyScalarFieldEnum,
            ),
          )
        },
        {
          message: `Invalid candidacy column provided. Allowed columns are: ${candidacyColumns.join(', ')}`,
        },
      ),
  })
  .strict()

export class RaceFilterDto extends createZodDto(raceFilterSchema) {}

const brHashIdParamSchema = z.object({
  // BallotReady GraphQL Node IDs are base64 strings of `gid://...`. They
  // always decode from `Z2lkOi8v` (the encoded prefix `gid://`). We accept
  // any non-empty string here and let the lookup decide whether it matches
  // a real Race row; that keeps validation lenient enough to not block on
  // unexpected format variations from BR while still rejecting empty input.
  brHashId: z.string().trim().min(1, 'brHashId is required'),
})

export class GetRaceByBrHashIdParamsDTO extends createZodDto(
  brHashIdParamSchema,
) {}
