import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'

export class ContactUploadParamsDTO extends createZodDto(
  z.object({ id: z.uuid() }),
) {}

export class ContactUploadRowParamsDTO extends createZodDto(
  z.object({ id: z.uuid(), rowId: z.uuid() }),
) {}

export class ContactSourcesParamsDTO extends createZodDto(
  z.object({ personId: z.guid() }),
) {}
