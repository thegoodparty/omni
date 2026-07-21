import { ContactNoteInputSchema } from '@goodparty_org/contracts'
import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'

export class ContactNoteBodyDTO extends createZodDto(ContactNoteInputSchema) {}

const contactNotePersonParamsSchema = z.object({
  personId: z.string().min(1),
})

export class ContactNotePersonParamsDTO extends createZodDto(
  contactNotePersonParamsSchema,
) {}

const contactNoteIdParamsSchema = z.object({
  noteId: z.guid(),
})

export class ContactNoteIdParamsDTO extends createZodDto(
  contactNoteIdParamsSchema,
) {}
