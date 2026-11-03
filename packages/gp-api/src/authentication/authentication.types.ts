import { OrganizationRole, User } from '../generated/prisma'
import { VerifiedM2MToken } from '@/authentication/interfaces/auth-provider.interface'
import {
  VercelOidcMachine,
  VercelOidcServiceReader,
} from '@/authentication/vercelOidc.service'
import { GithubOidcServiceReader } from '@/authentication/githubOidc.service'

export type M2MCaller =
  | (VerifiedM2MToken & { source: 'clerk' })
  | VercelOidcMachine

export interface IncomingRequest extends Request {
  headers: Headers & { authorization?: string }
  user?: User & { impersonating?: boolean }
  actorUser?: User
  actorSub?: string
  m2mToken?: M2MCaller
  serviceReader?: VercelOidcServiceReader | GithubOidcServiceReader
  agentToken?: boolean
  organizationRole?: OrganizationRole
}
