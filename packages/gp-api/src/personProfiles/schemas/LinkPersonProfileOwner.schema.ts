import { createZodDto } from 'nestjs-zod'
import {
  GetPersonProfileLinkQuerySchema,
  LinkPersonProfileOwnerInputSchema,
} from '@goodparty_org/contracts'

export class LinkPersonProfileOwnerDto extends createZodDto(
  LinkPersonProfileOwnerInputSchema,
) {}

export class GetPersonProfileLinkDto extends createZodDto(
  GetPersonProfileLinkQuerySchema,
) {}

export {
  PersonProfileLinkSchema,
  type PersonProfileLink,
} from '@goodparty_org/contracts'
