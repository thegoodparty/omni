import { IncomingRequest } from '@/authentication/authentication.types'

// Set by GithubOrgMemberGuard from the verified membership response so the
// audit line can name who fetched a bundle. The GitHub token that proved it
// is never carried past the guard.
export interface DevEnvRequest extends IncomingRequest {
  githubLogin?: string
}
