import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'

const optionalText = z.string().trim().max(500).optional()

const pocImportRowSchema = z.object({
  firstName: z.string().trim().min(1).max(200),
  lastName: z.string().trim().min(1).max(200),
  address: optionalText,
  city: optionalText,
  zip: optionalText,
  phone: optionalText,
  email: optionalText,
})

export type PocImportRow = z.infer<typeof pocImportRowSchema>

export class PocImportDTO extends createZodDto(
  z.object({ rows: z.array(pocImportRowSchema).min(1).max(5000) }),
) {}

export class PocImportParamsDTO extends createZodDto(
  z.object({ importId: z.guid() }),
) {}

export class PocPersonParamsDTO extends createZodDto(
  z.object({ personId: z.guid() }),
) {}

export class PocSetFieldDTO extends createZodDto(
  z.object({ field: z.string(), value: z.string().max(500).nullable() }),
) {}
