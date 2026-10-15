import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { UserRole } from '../../generated/prisma'
import { IncomingRequest } from '@/authentication/authentication.types'
import { effectiveUser } from '@/authentication/util/effectiveUser.util'

@Injectable()
export class ServiceReadGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<IncomingRequest>()
    return Boolean(
      req.serviceReader ||
      req.m2mToken ||
      effectiveUser(req)?.roles.includes(UserRole.admin),
    )
  }
}
