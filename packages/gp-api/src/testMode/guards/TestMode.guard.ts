import { IncomingRequest } from '@/authentication/authentication.types'
import { FeaturesService } from '@/features/services/features.service'
import { isInternalUser } from '@/users/util/users.util'
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common'

export const STAFF_TEST_MODE_FLAG = 'staff-test-mode'

// Authorizes on the SESSION user, never the effective user: an admin
// impersonating a candidate must not reach Test mode on that candidate's
// behalf, and the global SessionGuard admits M2M tokens without a user.
@Injectable()
export class TestModeGuard implements CanActivate {
  constructor(private readonly features: FeaturesService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<IncomingRequest>()
    const user = req.user
    if (
      !user ||
      user.impersonating ||
      req.actorUser ||
      req.m2mToken ||
      req.agentToken ||
      !isInternalUser({ email: user.email })
    ) {
      throw new ForbiddenException()
    }

    const enabled = await this.features.isFeatureEnabled({
      user,
      feature: STAFF_TEST_MODE_FLAG,
    })
    if (!enabled) {
      throw new ForbiddenException()
    }
    return true
  }
}
