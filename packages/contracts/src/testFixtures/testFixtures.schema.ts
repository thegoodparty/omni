import { z } from 'zod'

export const TEST_FIXTURE_STATE_VALUES = [
  'free-win',
  'pro-win',
  'serve',
  'serve-won-race',
] as const
export type TestFixtureState = (typeof TEST_FIXTURE_STATE_VALUES)[number]
export const TestFixtureStateSchema = z.enum(TEST_FIXTURE_STATE_VALUES)

// The exact cookie triple gp-webapp authenticates with, ready to inject into a
// browser context (same shape the e2e suite's api-registration helper sets).
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
