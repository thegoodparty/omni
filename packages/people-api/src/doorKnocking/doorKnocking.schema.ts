import { createZodDto } from 'nestjs-zod'
import {
  DoorKnockingEvaluateRequestSchema,
  DoorKnockingPackRequestSchema,
  DoorKnockingResidentsRequestSchema,
} from '@goodparty_org/contracts'
import { filtersSchema } from 'src/people/schemas/filters.schema'

// The wire shape is the contracts schema verbatim; only `filters` is swapped
// for the server-side variant that transforms the grammar into the SQL
// pipeline's FilterData.
const evaluateSchema = DoorKnockingEvaluateRequestSchema.extend({
  filters: filtersSchema,
})

export class DoorKnockingEvaluateDTO extends createZodDto(evaluateSchema) {}

export class DoorKnockingResidentsDTO extends createZodDto(
  DoorKnockingResidentsRequestSchema,
) {}

export class DoorKnockingPackDTO extends createZodDto(
  DoorKnockingPackRequestSchema,
) {}
