import {
  IdOverridesSchema,
  MAX_OVERLAP_SAVED_FILTER_SETS,
  MAX_PAGE,
  MAX_PAGINATION_OFFSET,
  MAX_RESULTS_PER_PAGE,
} from '@goodparty_org/contracts'
import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'

import { filtersSchema } from './schemas/filters.schema'
import { EXCLUDABLE_VOTER_COLUMNS } from './people.select'

const withDistrictInput = <T extends z.ZodRawShape>(shape: T) =>
  z.object({ districtId: z.guid() }).extend(shape)

export const listPeopleSchema = withDistrictInput({
  filters: filtersSchema,
  // Override-aware Voter Likelihood filtering (ENG-10838): a sibling of
  // `filters`, not a PeopleFilters field — gp-api resolves include/exclude
  // person-id sets from contact-status overrides and composes them as an OR
  // scoped to the voterStatus clause only (buildVoterFiltersSql). Omitted
  // when the org has no overrides, so the SQL stays byte-identical to today.
  idOverrides: IdOverridesSchema.optional(),
  search: z.string().optional(),
  // resultsPerPage feeds `LIMIT ${take}` and page feeds `OFFSET ${skip}` in raw
  // SQL (people.service.ts), so this is the last line of defense against
  // extracting a whole district/state in one request or exhausting this shared
  // service's memory. Caps are shared with the gp-api edge schema via contracts;
  // page min(1) keeps the OFFSET non-negative and a finite max bounds its depth.
  resultsPerPage: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_RESULTS_PER_PAGE)
    .optional()
    .default(50),
  page: z.coerce.number().int().min(1).max(MAX_PAGE).optional().default(1),
  // Door-knocking de-dupes by physical household: one representative voter per
  // residence-address composite (see buildHouseholdKeySql). Off → one row per
  // voter (the legacy behavior every other channel uses).
  groupByHousehold: z.coerce.boolean().optional().default(false),
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

export class ListPeopleDTO extends createZodDto(listPeopleSchema) {}

export const downloadPeopleSchema = withDistrictInput({
  filters: filtersSchema,
  // See listPeopleSchema's idOverrides comment (ENG-10838) — same sibling
  // shape, threaded so a Voter-Likelihood-filtered download matches the
  // count/list membership.
  idOverrides: IdOverridesSchema.optional(),
  // Mirror the list endpoint: door-knocking exports one row per physical
  // household so the CSV matches the on-screen de-duplicated list.
  groupByHousehold: z.coerce.boolean().optional().default(false),
  // Column-exclusion escape hatch for the caller's own visibility rules
  // (ENG-10696: gp-api sends this for `eo-` orgs to drop the party column).
  // The CSV is a Postgres COPY stream gp-api can't post-process, so the
  // projection itself must exclude it. Bounded to a known-safe enum — never
  // an arbitrary caller-supplied column name reaching raw SQL.
  excludeColumns: z.array(z.enum(EXCLUDABLE_VOTER_COLUMNS)).optional(),
})

export class DownloadPeopleDTO extends createZodDto(downloadPeopleSchema) {}

export class StatsDTO extends createZodDto(withDistrictInput({})) {}

// Filtered aggregates (COUNT/AVG age/AVG income) over a list-detail page's
// membership — distinct from GET /stats, which only serves the precomputed,
// unfiltered DistrictStats row (see StatsService).
export const aggregatesSchema = withDistrictInput({
  filters: filtersSchema,
  // See listPeopleSchema's idOverrides comment (ENG-10838).
  idOverrides: IdOverridesSchema.optional(),
})

export class AggregatesDTO extends createZodDto(aggregatesSchema) {}

// Saved-list overlap count (ENG-10840): the current in-progress selection
// AND'd with the union of the org's saved lists. `filtersSchema` already
// transforms a raw PeopleFilters object into FilterData, so reusing it as an
// array element schema transforms every saved set the same way `filters`
// gets transformed — one saved-set-worth of the same pipeline the count path
// runs.
export const overlapCountSchema = withDistrictInput({
  filters: filtersSchema,
  // See listPeopleSchema's idOverrides comment (ENG-10838) — applies to the
  // current in-progress `filters` selection only. `savedFilterSets` entries
  // are deliberately NOT override-aware yet (see buildOverlapCountSql.utils.ts).
  idOverrides: IdOverridesSchema.optional(),
  search: z.string().optional(),
  savedFilterSets: z.array(filtersSchema).max(MAX_OVERLAP_SAVED_FILTER_SETS),
})

export class OverlapCountDTO extends createZodDto(overlapCountSchema) {}

export const samplePeopleSchema = withDistrictInput({
  size: z.coerce.number().int().min(1).max(10000).optional().default(500),
  hasCellPhone: z.coerce.boolean().optional(),
  excludeIds: z.array(z.guid()).optional(),
})

export class SamplePeopleDTO extends createZodDto(samplePeopleSchema) {}

export class GetPersonParamsDTO extends createZodDto(
  z.object({
    id: z.guid(),
  }),
) {}

export const getPersonQuerySchema = withDistrictInput({})

export class GetPersonQueryDTO extends createZodDto(getPersonQuerySchema) {}

export type ListPeopleSchema = z.infer<typeof listPeopleSchema>
export type DownloadPeopleSchema = z.infer<typeof downloadPeopleSchema>
