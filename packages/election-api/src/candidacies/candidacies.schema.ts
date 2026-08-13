import { createZodDto } from 'nestjs-zod'
import { STATE_CODES } from '@goodparty_org/nest-common'
import { toUpper } from 'src/shared/util/strings.util'
import { z } from 'zod'
import { Prisma } from '../generated/prisma'

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
            candidacyColumns.includes(
              col as keyof typeof Prisma.CandidacyScalarFieldEnum,
            ),
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
            raceColumns.includes(
              col as keyof typeof Prisma.RaceScalarFieldEnum,
            ),
          )
        },
        {
          message: `Invalid race column provided. Allowed columns are: ${raceColumns.join(', ')}`,
        },
      ),
  })
  .strict()

export class CandidacyFilterDto extends createZodDto(candidacyFilterSchema) {}
