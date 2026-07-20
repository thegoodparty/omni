import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'
import {
  CreateOrdinanceRequestSchema,
  ORDINANCE_EXPORT_FORMATS,
  SaveOrdinanceClarifyAnswerRequestSchema,
  UpdateOrdinanceRequestSchema,
} from '@goodparty_org/contracts'

export type { OrdinanceExportFormat } from '@goodparty_org/contracts'

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

const OrdinanceExportQuerySchema = z.object({
  format: z.enum(ORDINANCE_EXPORT_FORMATS),
})

export class OrdinanceExportQueryDto extends createZodDto(
  OrdinanceExportQuerySchema,
) {}
