import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { IncomingRequest } from '@/authentication/authentication.types'
import { isHandoffRoute } from '@/authentication/util/handoffRoute.util'

@Injectable()
export class HandoffAgentGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<IncomingRequest>()
    if (req.m2mToken) return true
    return Boolean(req.handoffAgent) && isHandoffRoute(context)
  }
}
