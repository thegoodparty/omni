import { createZodDto } from 'nestjs-zod'
import { z } from 'zod'

// The form a subscribe lands on when the caller names none.
export const DEFAULT_SUBSCRIBE_FORM_ID = '5d84452a-01df-422b-9734-580148677d2c'

// `formId` picks which HubSpot form the submission is written to, so it is an
// allow-list rather than a free string: only forms we own can be targeted.
export const ALLOWED_SUBSCRIBE_FORM_IDS = [DEFAULT_SUBSCRIBE_FORM_ID] as const

// The only contact property a caller may set beyond the named fields below.
export const ALLOWED_ADDITIONAL_FIELD_NAMES = ['candidate_interest'] as const

export const MAX_ADDITIONAL_FIELDS = 20
export const MAX_ADDITIONAL_FIELD_VALUE_LENGTH = 500

export class SubscribeEmailSchema extends createZodDto(
  z.object({
    email: z.string().email(),
    name: z.string().max(200).optional(),
    uri: z.string().url(),
    formId: z.enum(ALLOWED_SUBSCRIBE_FORM_IDS).optional(),
    pageName: z.string().max(200).optional(),
    firstName: z.string().max(100).optional(),
    lastName: z.string().max(100).optional(),
    phone: z.string().max(40).optional(),
    additionalFields: z
      .array(
        z.object({
          name: z.enum(ALLOWED_ADDITIONAL_FIELD_NAMES),
          value: z.string().max(MAX_ADDITIONAL_FIELD_VALUE_LENGTH),
        }),
      )
      .max(MAX_ADDITIONAL_FIELDS)
      .optional(),
  }),
) {}
