import { z } from 'zod'
import { CreateUserInputSchema } from './CreateUserInput.schema'
import { UserMetaDataSchema } from './UserMetaData.schema'
import { EmailSchema } from '../shared/Email.schema'
import { PhoneSchema } from '../shared/Phone.schema'
import { RolesSchema } from '../shared/Roles.schema'
import { ZipSchema } from '../shared/Zip.schema'
import { makeOptional } from '../shared/zod.util'
import { zCoerceDate } from '../shared/Date.schema'

export const ReadUserOutputSchema = CreateUserInputSchema.omit({
  password: true,
  allowTexts: true,
  signUpMode: true,
}).extend({
  // firstName/lastName override CreateUserInputSchema's min(2): that's a
  // signup-form rule, but the DB column has no such constraint (nullable,
  // default ''), so plenty of existing rows are shorter than 2 chars.
  // Enforcing it here made the global ZodResponseInterceptor 500 on any
  // response that included one of those rows.
  firstName: z.string(),
  lastName: z.string(),
  name: z.string().nullish(),
  zip: makeOptional(ZipSchema),
  phone: makeOptional(PhoneSchema),
  id: z.number(),
  email: EmailSchema,
  avatar: z.string().nullish(),
  hasPassword: z.boolean(),
  roles: RolesSchema,
  metaData: UserMetaDataSchema,
  createdAt: zCoerceDate(),
})

export type ReadUserOutput = z.infer<typeof ReadUserOutputSchema>
