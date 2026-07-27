/**
 * The `filters` input grammar (operator shapes, enum vocabularies, array
 * caps, example JSON) is defined in @goodparty_org/contracts
 * (`PeopleFiltersSchema`) so the producer (gp-api) and this service
 * validate against one definition. This file owns only the server-side
 * transform into the SQL pipeline's FilterData shape.
 */

import {
  type PeopleFilters,
  PeopleFiltersSchema,
} from '@goodparty_org/contracts'
import {
  transformFilters,
  type TransformFiltersResult,
} from './filters.schema.utils'

export type AllowedFilter = keyof PeopleFilters

export const filtersSchema = PeopleFiltersSchema.optional()
  .default({})
  .transform((filters) =>
    transformFilters<AllowedFilter>(filters, PeopleFiltersSchema.shape),
  )

export type { FilterOperator } from './filters.schema.utils'

export type FilterData = TransformFiltersResult<AllowedFilter>
