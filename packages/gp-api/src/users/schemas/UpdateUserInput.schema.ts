import { CreateUserInputSchema } from './CreateUserInput.schema'
import {
  ChangeUserEmailInputSchema as ChangeUserEmailContractSchema,
  UserMetaDataSchema,
} from '@goodparty_org/contracts'
import { createZodDto } from 'nestjs-zod'

// No email: User.email gates staff and test-user affordances, so a user may
// only change it through Clerk, which verifies the address first. Zod strips
// the key, so a stale client that still sends it saves everything else.
export class UpdateUserInputSchema extends createZodDto(
  CreateUserInputSchema.omit({
    password: true,
    roles: true,
    email: true,
  }).partial(),
) {}

// No email here either: staff change it through PUT /v1/users/:id/email,
// which moves Clerk and HubSpot with it.
export class UpdateUserAdminInputSchema extends createZodDto(
  CreateUserInputSchema.omit({ password: true, email: true }).partial().extend({
    metaData: UserMetaDataSchema,
  }),
) {}

export class ChangeUserEmailInputSchema extends createZodDto(
  ChangeUserEmailContractSchema,
) {}
