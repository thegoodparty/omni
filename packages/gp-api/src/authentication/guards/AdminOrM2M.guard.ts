import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { UserRole } from '../../generated/prisma'
import { IncomingRequest } from '@/authentication/authentication.types'
import { effectiveUser } from '@/authentication/util/effectiveUser.util'

// TODO: remove after we sunset the existing admin ENG-6732
@Injectable()
export class AdminOrM2MGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<IncomingRequest>()
    // Never authorize on req.actorSub (mere presence of an act claim): trusting
    // it let a demoted admin's still-valid actor token keep admin access
    // (CWE-285). isAdmin checks the actor's CURRENT roles via effectiveUser.
    const isAdmin = effectiveUser(req)?.roles.includes(UserRole.admin)
    return Boolean(req.m2mToken || isAdmin)
  }
}
