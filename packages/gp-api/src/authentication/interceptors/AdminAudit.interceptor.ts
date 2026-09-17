import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { UserRole } from '../../generated/prisma'
import { ROLES_KEY } from '../decorators/Roles.decorator'
import { IncomingRequest } from '@/authentication/authentication.types'
import { effectiveUser } from '@/authentication/util/effectiveUser.util'
import { FastifyRequest } from 'fastify'
import { PinoLogger } from 'nestjs-pino'

// Fastify for the transport fields, `IncomingRequest` for the identities
// `SessionGuard` attaches.
type AuditRequest = FastifyRequest &
  Pick<IncomingRequest, 'user' | 'actorUser' | 'actorSub'>

@Injectable()
export class AdminAuditInterceptor implements NestInterceptor {
  constructor(
    private reflector: Reflector,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('AdminAudit')
  }

  intercept(context: ExecutionContext, next: CallHandler) {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    )

    if (!requiredRoles?.includes(UserRole.admin)) {
      return next.handle()
    }

    const request = context.switchToHttp().getRequest<AuditRequest>()

    const { user, actorUser, actorSub, method, url, ip, headers, body } =
      request

    // `RolesGuard` admits these routes on `effectiveUser`, so that is the
    // human accountable for the action. Reading `user` directly named the
    // impersonated candidate instead, which meant an admin acting through
    // impersonation left a trail pointing at the person they acted upon.
    // Guards run before interceptors, so this is non-null by the time we
    // get here.
    const actedBy = effectiveUser(request)

    const auditInfo = {
      timestamp: new Date().toISOString(),
      userId: actedBy?.id,
      userEmail: actedBy?.email,
      // Only present while impersonating, so their absence means the admin
      // acted as themselves rather than meaning nothing was recorded.
      ...(actorUser && {
        impersonatedUserId: user?.id,
        impersonatedUserEmail: user?.email,
      }),
      // An `act` claim we could not resolve to a local user. `RolesGuard`
      // then falls back to the subject's own roles, so `userId` above is the
      // authorized party — but the request did arrive through impersonation,
      // and an audit trail should not quietly drop that.
      ...(actorSub && !actorUser && { unresolvedActorSub: actorSub }),
      endpoint: url,
      httpMethod: method,
      ipAddress: ip || headers['x-forwarded-for'] || headers['x-real-ip'],
      userAgent: headers['user-agent'],
      requiredRoles,
      body,
    }

    this.logger.info({ ...auditInfo, msg: 'Admin route accessed' })

    return next.handle()
  }
}
