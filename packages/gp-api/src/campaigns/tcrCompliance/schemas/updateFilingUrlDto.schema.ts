import { createZodDto } from 'nestjs-zod'
import { UpdateFilingUrlSchema } from '@goodparty_org/contracts'

export class UpdateFilingUrlDto extends createZodDto(UpdateFilingUrlSchema) {}
