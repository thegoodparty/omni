import { createZodDto } from 'nestjs-zod'
import { STATE_CODES } from '@goodparty_org/nest-common'
import { toUpper } from 'src/shared/util/strings.util'
import { z } from 'zod'
import { Prisma } from '../generated/prisma'

// Personal contact PII that must never be selectable on this public,
// unauthenticated endpoint (CWE-306). Kept out of both the column allowlist
// and the default response (via `omit` in persons.service.ts). Typed against
// the field enum so a typo fails the build rather than leaking PII.
export const PERSON_PII_COLUMNS = [
  'email',
  'phone',
] satisfies (keyof typeof Prisma.PersonScalarFieldEnum)[]

// Internal linkage columns that are filterable but must never be broadcast on
// this public, unauthenticated endpoint. `gpApiUserId` ties a person back to
// the originating gp-api user; it is queried by gp-api (filter-only) but is not
// public data, so it is excluded from both the column allowlist and every
// response body (via `omit` in persons.service.ts). Typed against the field
// enum so a typo fails the build.
export const PERSON_INTERNAL_COLUMNS = [
  'gpApiUserId',
] satisfies (keyof typeof Prisma.PersonScalarFieldEnum)[]

const PERSON_NON_SELECTABLE_COLUMNS: readonly string[] = [
  ...PERSON_PII_COLUMNS,
  ...PERSON_INTERNAL_COLUMNS,
]

export const personColumns = (
  Object.values(
    Prisma.PersonScalarFieldEnum,
  ) as (keyof typeof Prisma.PersonScalarFieldEnum)[]
).filter((col) => !PERSON_NON_SELECTABLE_COLUMNS.includes(col))

export const personFilterSchema = z
  .object({
    state: z
      .preprocess(toUpper, z.string())
      .optional()
      .refine((val) => {
        if (!val) return true
        return STATE_CODES.includes(val)
      }, 'Invalid state code'),
    slug: z.string().optional(),
    personId: z.guid('personId must be a valid UUID').optional(),
    // Filter-only linkage to the originating gp-api user. The gp-api User.id is
    // a numeric autoincrement passed as a string here — not a UUID. Never
    // returned in a response and never selectable via `columns` (see
    // PERSON_INTERNAL_COLUMNS + the `omit`s in persons.service.ts).
    gpApiUserId: z
      .string()
      .regex(/^\d+$/, 'gpApiUserId must be a numeric gp-api user id')
      .optional(),
    // Comma-separated UUIDs for batch lookup (e.g. building the /people sitemap
    // from the set of published personIds). Capped to keep the query bounded.
    ids: z
      .string()
      .optional()
      .transform((val) =>
        val
          ? val
              .split(',')
              .map((id) => id.trim())
              .filter(Boolean)
          : undefined,
      )
      .refine(
        (ids) =>
          !ids ||
          (ids.length <= 500 &&
            ids.every((id) => z.guid().safeParse(id).success)),
        'ids must be up to 500 comma-separated UUIDs',
      ),
    includeOfficeHolders: z.coerce.boolean().optional().default(false),
    includeCandidacies: z.coerce.boolean().optional().default(false),
    columns: z
      .string()
      .optional()
      .refine(
        (val) => {
          if (!val) return true
          const columns = val.split(',').map((col) => col.trim())
          return columns.every((col) =>
            personColumns.includes(
              col as keyof typeof Prisma.PersonScalarFieldEnum,
            ),
          )
        },
        {
          message: `Invalid person column provided. Allowed columns are: ${personColumns.join(', ')}`,
        },
      ),
  })
  .strict()

export const getPersonByIdParamsSchema = z.object({
  personId: z.guid('personId must be a valid UUID'),
})

export const getPersonBySlugParamsSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(255)
    // Slugs are lowercase alphanumerics + hyphens (see the person mart); reject
    // anything else so this can't be used to probe with arbitrary input.
    .regex(/^[a-z0-9-]+$/, 'slug must be lowercase alphanumeric or hyphen'),
})

export class PersonFilterDto extends createZodDto(personFilterSchema) {}
export class GetPersonByIdParamsDTO extends createZodDto(
  getPersonByIdParamsSchema,
) {}
export class GetPersonBySlugParamsDTO extends createZodDto(
  getPersonBySlugParamsSchema,
) {}
