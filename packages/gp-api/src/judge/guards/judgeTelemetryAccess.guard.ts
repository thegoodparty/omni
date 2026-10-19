import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { User } from '@/generated/prisma'
import { IS_NON_PROD_DEPLOY } from '@/shared/util/appEnvironment.util'
import { JUDGE_CHAT_EMAIL } from '../judgeTelemetry.util'

// Judge-only, non-prod-only access to the turn telemetry read.
//
// A guard rather than a check inside each handler, for the reason
// GithubOrgMemberGuard gives: the gate has to run before the handler does any
// work, and it has to apply to every route this controller gains later
// without anyone remembering to repeat it. The global SessionGuard still runs
// ahead of this one, so an anonymous prod request is answered 401 the way
// every authenticated route answers it; what this guarantees is that no
// authenticated caller, judge or not, can tell a prod deploy that the route
// is there.
//
// Both refusals are NotFoundException and neither says which applied: on a
// prod deploy the route does not exist, and to anyone but the judge it does
// not exist either.
@Injectable()
export class JudgeTelemetryAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (!IS_NON_PROD_DEPLOY) {
      throw new NotFoundException()
    }

    const request = context.switchToHttp().getRequest<{ user?: User }>()
    if (request.user?.email !== JUDGE_CHAT_EMAIL) {
      throw new NotFoundException()
    }
    return true
  }
}
