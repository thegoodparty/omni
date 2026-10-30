import {
  applyDecorators,
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
  SetMetadata,
  UseGuards,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { IS_NON_PROD_DEPLOY } from '@/shared/util/appEnvironment.util'

export const NON_PROD_DEPLOY_ONLY_KEY = 'nonProdDeployOnly'

// Keeps a controller off a production deploy: 404, never 403, so prod does not
// admit the routes exist. Every controller in src/testFixtures/ carries it, and
// a test fails when a new one does not.
//
// Nest runs global guards before class guards, so as a class guard alone this
// would answer an anonymous prod request 401 from SessionGuard first. The same
// class is therefore also registered as an APP_GUARD ahead of SessionGuard in
// AppModule; the metadata the decorator sets is how that global copy knows
// which routes it applies to.
@Injectable()
export class NonProdDeployGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const nonProdOnly = this.reflector.getAllAndOverride<boolean>(
      NON_PROD_DEPLOY_ONLY_KEY,
      [context.getHandler(), context.getClass()],
    )
    if (nonProdOnly && !IS_NON_PROD_DEPLOY) {
      throw new NotFoundException()
    }
    return true
  }
}

export const NonProdDeployOnly = () =>
  applyDecorators(
    SetMetadata(NON_PROD_DEPLOY_ONLY_KEY, true),
    UseGuards(NonProdDeployGuard),
  )
