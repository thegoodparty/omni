import { z } from 'zod'

// The admin surface for hand-linking a gp-api user to their canonical civics
// Person, for the users the data platform cannot link (see gp-api's
// PersonIdBackfillService.linkUserByOperator).

// linkedBy is supplied by the caller for the same reason a takedown's actor
// is: gp-admin reaches gp-api over a shared M2M token, so the request carries
// no operator identity of its own.
export const LinkPersonProfileOwnerInputSchema = z
  .object({
    userId: z.number().int().positive(),
    personId: z.guid('personId must be a valid UUID'),
    linkedBy: z.string().min(1, 'linkedBy is required').max(200),
  })
  .strict()

export type LinkPersonProfileOwnerInput = z.infer<
  typeof LinkPersonProfileOwnerInputSchema
>

export const GetPersonProfileLinkQuerySchema = z
  .object({
    userId: z.coerce.number().int().positive(),
  })
  .strict()

export type GetPersonProfileLinkQuery = z.infer<
  typeof GetPersonProfileLinkQuerySchema
>

// fullName and profileUrl come from the civics spine at read time, so both are
// null for an unlinked user and when that lookup fails.
export const PersonProfileLinkSchema = z.object({
  userId: z.number(),
  personId: z.string().nullable(),
  fullName: z.string().nullable(),
  profileUrl: z.string().nullable(),
  hasProfile: z.boolean(),
})

export type PersonProfileLink = z.infer<typeof PersonProfileLinkSchema>
