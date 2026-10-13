import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { UserRole } from '../../generated/prisma'
import { IncomingRequest } from '@/authentication/authentication.types'
import { effectiveUser } from '@/authentication/util/effectiveUser.util'

// Only for routes whose personId query param names the single record being
// read; on any other route the owner clause would let a caller self-authorize.
@Injectable()
export class ServiceReadOrOwnerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<IncomingRequest & { query?: Record<string, unknown> }>()
    if (req.serviceReader || req.m2mToken) {
      return true
    }
    if (effectiveUser(req)?.roles.includes(UserRole.admin)) {
      return true
    }
    const ownPersonId = req.user?.personId
    const requestedPersonId = req.query?.personId
    return (
      typeof ownPersonId === 'string' &&
      typeof requestedPersonId === 'string' &&
      ownPersonId.toLowerCase() === requestedPersonId.toLowerCase()
    )
  }
}
