import { createZodDto } from 'nestjs-zod'
import { STATE_CODES } from '@goodparty_org/nest-common'
import { toUpper } from '@/electionDb/shared/util/strings.util'
import { z } from 'zod'
import { Prisma } from '@/generated/election-prisma'

// Candidate PII that must never be selectable on this public, unauthenticated
// endpoint. `email` is personal contact data — exposing it lets anyone page
// through candidacies and harvest addresses in bulk (CWE-306). It is kept out
// of both the column allowlist (below) and the default response (via `omit` in
// candidacies.service.ts).
// Typed against the field enum so a typo (e.g. 'Email') fails the build rather
// than silently leaving PII selectable.
export const CANDIDACY_PII_COLUMNS = [
  'email',
] satisfies (keyof typeof Prisma.CandidacyScalarFieldEnum)[]

export const candidacyColumns = (
  Object.values(
    Prisma.CandidacyScalarFieldEnum,
  ) as (keyof typeof Prisma.CandidacyScalarFieldEnum)[]
).filter((col) => !(CANDIDACY_PII_COLUMNS as readonly string[]).includes(col))
const raceColumns = Object.values(
  Prisma.RaceScalarFieldEnum,
) as (keyof typeof Prisma.RaceScalarFieldEnum)[]

// `GET /candidacies` ran an unbounded `findMany`, so a broad filter like
// `?state=TX` — or none at all — could materialize the whole table, with
// stances, issues and races eagerly loaded. Same bug `GET /races` already
// fixed; same shape of fix. The default is deliberately generous so a
// realistically-filtered caller still gets its full result in one page, while
// an unfiltered scan stays bounded. Callers needing more walk pages via `page`.
export const DEFAULT_CANDIDACY_PAGE_SIZE = 1000
export const MAX_CANDIDACY_PAGE_SIZE = 5000

export const candidacyFilterSchema = z
  .object({
    state: z
      .preprocess(toUpper, z.string())
      .optional()
      .refine((val) => {
        if (!val) return true
        return STATE_CODES.includes(val)
      }, 'Invalid state code'),
    slug: z.string().optional(),
    raceSlug: z.string().optional(),
    // Filter candidacies by the position they are running for. Candidacy has no
    // direct positionId; it is resolved through the candidacy's Race
    // (Race.positionId). Powers "Other Candidates for [Position]".
    positionId: z.guid('positionId must be a valid UUID').optional(),
    includeStances: z.coerce.boolean().optional().default(false),
    includeRace: z.coerce.boolean().optional().default(false),
    columns: z
      .string()
      .optional()
      .refine(
        (val) => {
          if (!val) return true
          const columns = val.split(',').map((col) => col.trim())
          return columns.every((col) =>
            (candidacyColumns as readonly string[]).includes(col),
          )
        },
        {
          message: `Invalid candidacy column provided. Allowed columns are: ${candidacyColumns.join(', ')}`,
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
    // holds for in-process callers that build the filter directly, and there
    // is one place to reason about it. The max still rejects an oversized ask.
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_CANDIDACY_PAGE_SIZE)
      .optional(),
  })
  .strict()

export class CandidacyFilterDto extends createZodDto(candidacyFilterSchema) {}
