import { createZodDto } from 'nestjs-zod'
import { EmailSchema, PhoneSchema } from '@goodparty_org/contracts'
import { z } from 'zod'

export const MAX_CONTACT_FORM_NAME_LENGTH = 120
export const MAX_CONTACT_FORM_MESSAGE_LENGTH = 2000

export class ContactFormSchema extends createZodDto(
  z.object({
    name: z.string().max(MAX_CONTACT_FORM_NAME_LENGTH),
    email: EmailSchema,
    phone: PhoneSchema.optional(),
    message: z.string().max(MAX_CONTACT_FORM_MESSAGE_LENGTH),
    smsConsent: z.boolean(),
  }),
) {}
