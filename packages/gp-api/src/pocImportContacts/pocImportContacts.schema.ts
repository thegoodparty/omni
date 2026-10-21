import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'

export const MAX_IMPORT_ROWS = 5000

const optionalText = z.string().trim().max(500).optional()

const importRowSchema = z.object({
  firstName: z.string().trim().min(1).max(200),
  lastName: z.string().trim().min(1).max(200),
  email: optionalText,
  phone: optionalText,
  address: optionalText,
  city: optionalText,
  zip: optionalText,
})

export type ImportContactRow = z.infer<typeof importRowSchema>

export const importCandidateSchema = z.object({
  personId: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  address: z.string().nullable(),
  city: z.string().nullable(),
  zip: z.string().nullable(),
  age: z.number().nullable(),
})

export type ImportCandidate = z.infer<typeof importCandidateSchema>

export class CreateContactImportDTO extends createZodDto(
  z.object({
    fileName: z.string().trim().min(1).max(300),
    consentAffirmed: z.literal(true),
    rows: z.array(importRowSchema).min(1).max(MAX_IMPORT_ROWS),
  }),
) {}

export class ContactImportParamsDTO extends createZodDto(
  z.object({ importId: z.guid() }),
) {}

export class ContactImportRowParamsDTO extends createZodDto(
  z.object({
    importId: z.guid(),
    rowIndex: z.coerce.number().int().min(0),
  }),
) {}

export class AmbiguousRowsQueryDTO extends createZodDto(
  z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(50).default(10),
  }),
) {}

export class ResolveImportRowDTO extends createZodDto(
  z
    .object({
      resolution: z.enum(['link', 'skip']),
      personId: z.string().min(1).optional(),
    })
    .refine((body) => (body.resolution === 'link') === !!body.personId, {
      message: 'personId is required to link and not allowed to skip',
    }),
) {}
