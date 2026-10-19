import { createZodDto } from 'nestjs-zod'
import {
  DoorKnockingEvaluateRequestSchema,
  DoorKnockingPackRequestSchema,
  DoorKnockingResidentsRequestSchema,
} from '@goodparty_org/contracts'
import { z } from 'zod'
import { filtersSchema } from './filters.schema'
import { AFFINITY_COLUMNS } from '../affinityColumns.const'

// The wire shape is the contracts schema verbatim; only `filters` is swapped
// for the server-side variant that transforms the grammar into the SQL
// pipeline's FilterData.
const evaluateSchema = DoorKnockingEvaluateRequestSchema.extend({
  filters: filtersSchema,
  // See people.schema.ts. Set by gp-api only.
  affinityColumn: z.enum(AFFINITY_COLUMNS).optional(),
  // Set by gp-api only: the civic panel's doors in one census tract.
  tract: z
    .string()
    .regex(/^\d{11}$/)
    .optional(),
})

export class DoorKnockingEvaluateDTO extends createZodDto(evaluateSchema) {}

export class DoorKnockingResidentsDTO extends createZodDto(
  DoorKnockingResidentsRequestSchema,
) {}

export class DoorKnockingPackDTO extends createZodDto(
  DoorKnockingPackRequestSchema,
) {}
