import { TestFixtureStateSchema, zCoerceDate } from '@goodparty_org/contracts'
import { z } from 'zod'

export const CreateTestFixtureUserSchema = z
  .object({
    state: TestFixtureStateSchema,
    activity: z.literal('seeded').optional(),
    race: z
      .object({
        zip: z.string().regex(/^\d{5}$/),
        office: z.string().min(1),
      })
      .optional(),
    serve: z
      .object({
        positionId: z.string().min(1).optional(),
        termStartDate: zCoerceDate().optional(),
        termEndDate: zCoerceDate().optional(),
      })
      .optional(),
    user: z
      .object({
        firstName: z.string().min(1).optional(),
        lastName: z.string().min(1).optional(),
      })
      .optional(),
  })
  // A free Win account has no outreach to show, so there is nothing to seed.
  .refine((body) => !(body.activity && body.state === 'free-win'), {
    message: 'Seeded activity needs pro-win, serve or serve-won-race',
    path: ['activity'],
  })
export type CreateTestFixtureUserInput = z.infer<
  typeof CreateTestFixtureUserSchema
>

export const DeleteTestFixtureUsersSchema = z
  .object({
    userIds: z.array(z.number().int().positive()).max(50).optional(),
    emails: z.array(z.string().email()).max(50).optional(),
  })
  .refine(
    (body) => (body.userIds?.length ?? 0) + (body.emails?.length ?? 0) > 0,
    { message: 'Provide at least one userId or email' },
  )
export type DeleteTestFixtureUsersInput = z.infer<
  typeof DeleteTestFixtureUsersSchema
>

export const MintTestFixtureSessionSchema = z
  .object({
    orgSlug: z.string().min(1).optional(),
  })
  .default({})
export type MintTestFixtureSessionInput = z.infer<
  typeof MintTestFixtureSessionSchema
>
