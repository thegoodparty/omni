import {
  CallHandler,
  CanActivate,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  Type,
} from '@nestjs/common'
import { GUARDS_METADATA } from '@nestjs/common/constants'
import { Reflector } from '@nestjs/core'
import { UserRole } from '../../generated/prisma'
import { ROLES_KEY } from '../decorators/Roles.decorator'
import { IncomingRequest } from '@/authentication/authentication.types'
import { AdminOrM2MGuard } from '@/authentication/guards/AdminOrM2M.guard'
import { M2MOnly } from '@/authentication/guards/M2MOnly.guard'
import { effectiveUser } from '@/authentication/util/effectiveUser.util'
import { FastifyRequest } from 'fastify'
import { PinoLogger } from 'nestjs-pino'
import { z } from 'zod'

// Fastify for the transport fields, `IncomingRequest` for the identities
// `SessionGuard` attaches.
type AuditRequest = FastifyRequest &
  Pick<IncomingRequest, 'user' | 'actorUser' | 'actorSub' | 'm2mToken'>

const ActorEmailSchema = z.object({ actorEmail: z.string() })

@Injectable()
export class AdminAuditInterceptor implements NestInterceptor {
  constructor(
    private reflector: Reflector,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext('AdminAudit')
  }

  intercept(context: ExecutionContext, next: CallHandler) {
    const targets = [context.getHandler(), context.getClass()]
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      targets,
    )

    // Admin routes that machines may call carry one of these guards instead
    // of @Roles(admin), because RolesGuard would turn the machine caller away.
    const isMachineCallableAdminRoute = this.reflector
      .getAllAndMerge<
        Array<Type<CanActivate> | CanActivate>
      >(GUARDS_METADATA, targets)
      .some((guard) => guard === AdminOrM2MGuard || guard === M2MOnly)

    if (
      !requiredRoles?.includes(UserRole.admin) &&
      !isMachineCallableAdminRoute
    ) {
      return next.handle()
    }

    const request = context.switchToHttp().getRequest<AuditRequest>()

    const {
      user,
      actorUser,
      actorSub,
      m2mToken,
      method,
      url,
      ip,
      headers,
      body,
      query,
    } = request

    const requestInfo = {
      endpoint: url,
      httpMethod: method,
      ipAddress: ip || headers['x-forwarded-for'] || headers['x-real-ip'],
      userAgent: headers['user-agent'],
      requiredRoles,
      body,
    }

    if (m2mToken) {
      this.logger.info({
        timestamp: new Date().toISOString(),
        authSource: 'm2m',
        // The Clerk machine that holds the token, as Clerk verified it.
        machineId: m2mToken.subject,
        // gp-admin names the staff member it is calling for, in the body or
        // the query string. Nothing verifies it, and null means none was
        // given rather than that it went unrecorded.
        suppliedActorEmail:
          ActorEmailSchema.safeParse(body).data?.actorEmail ??
          ActorEmailSchema.safeParse(query).data?.actorEmail ??
          null,
        ...requestInfo,
        msg: 'Admin route accessed',
      })
      return next.handle()
    }

    // `RolesGuard` admits these routes on `effectiveUser`, so that is the
    // human accountable for the action. Reading `user` directly named the
    // impersonated candidate instead, which meant an admin acting through
    // impersonation left a trail pointing at the person they acted upon.
    // Guards run before interceptors, so this is non-null by the time we
    // get here.
    const actedBy = effectiveUser(request)

    const auditInfo = {
      timestamp: new Date().toISOString(),
      authSource: 'session',
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
      ...requestInfo,
    }

    this.logger.info({ ...auditInfo, msg: 'Admin route accessed' })

    return next.handle()
  }
}
