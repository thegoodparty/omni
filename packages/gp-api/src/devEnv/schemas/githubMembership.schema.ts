import { z } from 'zod'

// The slice of GitHub's org-membership response the guard reads
// (GET /user/memberships/orgs/{org}). `user.login` is the only identity the
// audit line records — the token itself never leaves the guard.
export const GithubMembershipSchema = z.object({
  state: z.string(),
  user: z.object({ login: z.string() }),
})
export type GithubMembership = z.infer<typeof GithubMembershipSchema>
