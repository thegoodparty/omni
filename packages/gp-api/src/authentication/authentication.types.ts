import { OrganizationRole, User } from '../generated/prisma'
import { VerifiedM2MToken } from '@/authentication/interfaces/auth-provider.interface'
import { VercelOidcServiceReader } from '@/authentication/vercelOidc.service'
import { GithubOidcServiceReader } from '@/authentication/githubOidc.service'

export interface IncomingRequest extends Request {
  headers: Headers & { authorization?: string }
  user?: User & { impersonating?: boolean }
  actorUser?: User
  actorSub?: string
  m2mToken?: VerifiedM2MToken
  serviceReader?:
    | VerifiedM2MToken
    | VercelOidcServiceReader
    | GithubOidcServiceReader
  agentToken?: boolean
  organizationRole?: OrganizationRole
}
