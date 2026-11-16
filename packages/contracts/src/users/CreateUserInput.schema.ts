import { z } from 'zod'
import { EmailSchema } from '../shared/Email.schema'
import { PasswordSchema } from '../shared/Password.schema'
import { PhoneSchema } from '../shared/Phone.schema'
import { RolesSchema } from '../shared/Roles.schema'
import { ZipSchema } from '../shared/Zip.schema'

export enum SIGN_UP_MODE {
  CANDIDATE = 'candidate',
  FACILITATED = 'facilitated',
}

export const CreateUserInputSchema = z.object({
  // Trimmed before the length check, so a padded single letter is rejected the
  // same way an unpadded one is, instead of passing on its whitespace.
  firstName: z.string().trim().min(2),
  lastName: z.string().trim().min(2),
  email: EmailSchema,
  password: PasswordSchema.optional(),
  name: z.string().trim().optional(),
  zip: ZipSchema.optional(),
  phone: PhoneSchema.optional(),
  roles: RolesSchema,
  signUpMode: z
    .enum([SIGN_UP_MODE.CANDIDATE, SIGN_UP_MODE.FACILITATED])
    .optional(),
  allowTexts: z.boolean().optional(),
})

export type CreateUserInput = z.infer<typeof CreateUserInputSchema>
