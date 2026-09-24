import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'
import { GeoJsonShapeSchema } from '@goodparty_org/contracts'
import { voterFilterBaseSchema } from '../../shared/schemas/voterFilterBase.schema'

export class UpdateVoterFileFilterSchema extends createZodDto(
  voterFilterBaseSchema
    .extend({
      name: z.string().min(1).optional(),
      // Explicit null clears the boundary and its frozen membership; an
      // absent key leaves both alone, which is what every pre-boundary
      // caller sends.
      geoPoly: GeoJsonShapeSchema.nullable().optional(),
    })
    .partial(),
) {}
