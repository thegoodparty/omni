import { z } from 'zod'

export const TEST_FIXTURE_STATE_VALUES = [
  'free-win',
  'pro-win',
  'serve',
  'serve-won-race',
] as const
export type TestFixtureState = (typeof TEST_FIXTURE_STATE_VALUES)[number]
export const TestFixtureStateSchema = z.enum(TEST_FIXTURE_STATE_VALUES)

// Cookie values a browser-driving consumer sets alongside a Clerk login.
// Only 'organization-slug' affects gp-webapp (it selects the active org);
// 'token'/'user' are for calling gp-api directly, not for webapp page auth —
// webapp routes are gated by the Clerk session, established by redeeming
// signInToken (see below).
export const TestFixtureCookiesSchema = z.object({
  token: z.string(),
  user: z.string(),
  'organization-slug': z.string(),
})

export const TestFixtureUserResponseSchema = z.object({
  state: TestFixtureStateSchema,
  userId: z.number(),
  clerkUserId: z.string(),
  email: z.string(),
  password: z.string(),
  campaignId: z.number().optional(),
  electedOfficeId: z.string().optional(),
  orgSlug: z.string(),
  campaignOrgSlug: z.string().optional(),
  sessionToken: z.string(),
  // Single-use Clerk sign-in ticket: redeem in the browser on a public page
  // via window.Clerk.client.signIn.create({ strategy: 'ticket', ticket })
  // to establish the real Clerk session gp-webapp's middleware gates on.
  signInToken: z.string(),
  cookies: TestFixtureCookiesSchema,
  expiresAt: z.string(),
})
export type TestFixtureUserResponse = z.infer<
  typeof TestFixtureUserResponseSchema
>

export const TestFixtureSessionResponseSchema = z.object({
  userId: z.number(),
  email: z.string(),
  sessionToken: z.string(),
  signInToken: z.string(),
  cookies: TestFixtureCookiesSchema,
  expiresAt: z.string(),
})
export type TestFixtureSessionResponse = z.infer<
  typeof TestFixtureSessionResponseSchema
>

export const DeleteTestFixtureUsersResponseSchema = z.object({
  deleted: z.array(z.object({ userId: z.number(), email: z.string() })),
  notFound: z.array(z.union([z.number(), z.string()])),
})
export type DeleteTestFixtureUsersResponse = z.infer<
  typeof DeleteTestFixtureUsersResponseSchema
>

export const TEST_FIXTURE_ACTIVITY_MAX_PEOPLE = 500

// How many residents answer the seeded priority, each with a coded answer.
// Every resident asked answers when it is left out.
export const TestFixtureAnswersSchema = z
  .number()
  .int()
  .min(0)
  .max(TEST_FIXTURE_ACTIVITY_MAX_PEOPLE)

// `lean` codes nine in ten answers yes, which lets every group read as
// heard; `even` splits them half yes and half no, which leaves the model
// unsure of its groups however many answer.
export const TestFixtureSplitSchema = z.enum(['lean', 'even'])

export const SeedTestFixtureActivityRequestSchema = z
  .object({
    people: z
      .number()
      .int()
      .min(20)
      .max(TEST_FIXTURE_ACTIVITY_MAX_PEOPLE)
      .optional(),
    answers: TestFixtureAnswersSchema.optional(),
    split: TestFixtureSplitSchema.optional(),
  })
  .strict()
  .default({})
export type SeedTestFixtureActivityRequest = z.infer<
  typeof SeedTestFixtureActivityRequestSchema
>

export const TestFixtureActivityEffortSchema = z.object({
  outreachId: z.number(),
  outreachType: z.string(),
  interactions: z.number(),
  memos: z.number(),
  synthesisRunId: z.string().nullable(),
})

export const SeedTestFixtureActivityResponseSchema = z.object({
  organizationSlug: z.string(),
  people: z.number(),
  efforts: z.array(TestFixtureActivityEffortSchema),
})
export type SeedTestFixtureActivityResponse = z.infer<
  typeof SeedTestFixtureActivityResponseSchema
>
