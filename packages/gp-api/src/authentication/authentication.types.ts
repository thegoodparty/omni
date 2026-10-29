import { OrganizationRole, User } from '../generated/prisma'
import { VerifiedM2MToken } from '@/authentication/interfaces/auth-provider.interface'
import { VercelOidcServiceReader } from '@/authentication/vercelOidc.service'

export interface IncomingRequest extends Request {
  headers: Headers & { authorization?: string }
  user?: User & { impersonating?: boolean }
  actorUser?: User
  actorSub?: string
  m2mToken?: VerifiedM2MToken
  serviceReader?: VerifiedM2MToken | VercelOidcServiceReader
  agentToken?: boolean
  organizationRole?: OrganizationRole
}
