import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'
import {
  CreateOrdinanceRequestSchema,
  SaveOrdinanceClarifyAnswerRequestSchema,
  UpdateOrdinanceRequestSchema,
} from '@goodparty_org/contracts'

export class CreateOrdinanceDto extends createZodDto(
  CreateOrdinanceRequestSchema,
) {}

export class UpdateOrdinanceDto extends createZodDto(
  UpdateOrdinanceRequestSchema,
) {}

export class SaveClarifyAnswerDto extends createZodDto(
  SaveOrdinanceClarifyAnswerRequestSchema,
) {}

const OrdinanceSlugParamSchema = z.object({ slug: z.string().min(1) })

export class OrdinanceSlugParamDto extends createZodDto(
  OrdinanceSlugParamSchema,
) {}

export const ORDINANCE_EXPORT_FORMATS = ['pdf', 'docx'] as const
export type OrdinanceExportFormat = (typeof ORDINANCE_EXPORT_FORMATS)[number]

const OrdinanceExportQuerySchema = z.object({
  format: z.enum(ORDINANCE_EXPORT_FORMATS),
})

export class OrdinanceExportQueryDto extends createZodDto(
  OrdinanceExportQuerySchema,
) {}
