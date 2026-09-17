import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common'

import { Observable } from 'rxjs'
import { Organization, OrganizationRole } from '../../generated/prisma'
import { runWithActorContext } from '../impersonation-context'

interface AnalyticsRequest {
  user?: { id?: number; impersonating?: boolean }
  actorSub?: string
  organization?: Organization
  organizationRole?: OrganizationRole
}

@Injectable()
export class ImpersonationInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AnalyticsRequest>()
    const isImpersonating =
      request.user?.impersonating === true || request.actorSub != null

    const actorUserId = request.user?.id ?? null

    // Every guard that attaches request.organization also sets
    // organizationRole in the same branch today, so this fallback is
    // insurance against a future guard that proves ownership (attaches
    // organization) without resolving a role for it — derive owner directly
    // from the ownerId match rather than leaving actorRole null in that case.
    const ownerFallback =
      request.organization && request.organization.ownerId === actorUserId
        ? OrganizationRole.owner
        : null
    const actorRole = request.organizationRole ?? ownerFallback

    return new Observable((subscriber) => {
      let inner: ReturnType<Observable<unknown>['subscribe']> | undefined
      runWithActorContext({ isImpersonating, actorUserId, actorRole }, () => {
        inner = next.handle().subscribe(subscriber)
      })
      return () => inner?.unsubscribe()
    })
  }
}
