import {
  MAX_PAGE,
  MAX_PAGINATION_OFFSET,
  MAX_RESULTS_PER_PAGE,
} from '@goodparty_org/contracts'
import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'

import { filtersSchema } from './schemas/filters.schema'

const withDistrictInput = <T extends z.ZodRawShape>(shape: T) =>
  z.object({ districtId: z.guid() }).extend(shape)

export const listPeopleSchema = withDistrictInput({
  filters: filtersSchema,
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
  // Mirror the list endpoint: door-knocking exports one row per physical
  // household so the CSV matches the on-screen de-duplicated list.
  groupByHousehold: z.coerce.boolean().optional().default(false),
})

export class DownloadPeopleDTO extends createZodDto(downloadPeopleSchema) {}

export class StatsDTO extends createZodDto(withDistrictInput({})) {}

// Default H3 resolution served when the caller does not pin one. Kept in sync
// with the data-team handoff (docs/voter-density-heatmap-handoff.md §6): res 8
// is the "city / county" default. Callers (gp-api) may override per office
// level once the adaptive policy lands.
export const DEFAULT_VOTER_DENSITY_RESOLUTION = 8

export const voterDensitySchema = withDistrictInput({
  // H3 resolution to return. The density table holds several resolutions per
  // district; we serve exactly one so cells never overlap. Bounded to the H3
  // range the pipeline emits.
  resolution: z.coerce
    .number()
    .int()
    .min(0)
    .max(15)
    .optional()
    .default(DEFAULT_VOTER_DENSITY_RESOLUTION),
})

export class VoterDensityDTO extends createZodDto(voterDensitySchema) {}

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
