import { z } from 'zod'
import { CreateUserInputSchema } from './CreateUserInput.schema'
import { UserMetaDataSchema } from './UserMetaData.schema'
import { EmailSchema } from '../shared/Email.schema'
import { PhoneSchema } from '../shared/Phone.schema'
import { RolesSchema } from '../shared/Roles.schema'
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
  // zip overrides CreateUserInputSchema's ZipSchema for the same reason
  // firstName/lastName override its min(2): `isPostalCode(val, 'US')` is a
  // signup-form rule, but the DB column is `zip String?` with no format
  // constraint, so rows exist that never passed it. Enforcing it here made
  // the global ZodResponseInterceptor 500 on any response containing one --
  // and because Zod validates the whole `data` array, a single bad row failed
  // an entire page of GET /v1/users rather than degrading one field.
  zip: z.string().nullish(),
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
