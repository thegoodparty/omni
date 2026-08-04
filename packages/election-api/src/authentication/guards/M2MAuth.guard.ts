import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ClerkClient } from '@clerk/backend'
import { PinoLogger } from 'nestjs-pino'
import { FastifyRequest } from 'fastify'
import { CLERK_CLIENT_PROVIDER_TOKEN } from '../providers/clerk-client.provider'
import { IS_PUBLIC_KEY } from '../decorators/PublicAccess.decorator'

type AuthenticatedRequest = FastifyRequest & { m2mToken?: unknown }

/**
 * Global default-deny guard. Every route requires a valid Clerk JWT-format M2M
 * token, verified networkless against ELECTION_API_MACHINE_SECRET, except
 * routes marked with `@PublicAccess()` (the ALB health check).
 *
 * Tokens are JWTs (`eyJ*`), so we don't gate on a prefix; `m2m.verify` rejects
 * anything that isn't a valid M2M token for this machine.
 *
 * Enforcement is gated on ELECTION_API_AUTH_ENFORCED so we can roll out in
 * two steps: first deploy in observe-only mode (verify + log, but never
 * reject) to confirm every real caller is sending a valid token, then flip
 * the flag to `true` to start rejecting.
 */
@Injectable()
export class M2MAuthGuard implements CanActivate {
  private readonly machineSecret = process.env.ELECTION_API_MACHINE_SECRET

  constructor(
    @Inject(CLERK_CLIENT_PROVIDER_TOKEN)
    private readonly clerkClient: ClerkClient,
    private readonly reflector: Reflector,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(M2MAuthGuard.name)
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (isPublic) return true

    const enforced = process.env.ELECTION_API_AUTH_ENFORCED === 'true'
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    const token = request.headers.authorization?.replace('Bearer ', '')

    try {
      if (!token) {
        throw new UnauthorizedException('Missing bearer token')
      }
      if (!this.machineSecret) {
        throw new UnauthorizedException(
          'ELECTION_API_MACHINE_SECRET is not configured',
        )
      }
      request.m2mToken = await this.clerkClient.m2m.verify({
        token,
        machineSecretKey: this.machineSecret,
      })
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (enforced) {
        this.logger.warn({ reason: message }, 'Rejected election-api request')
        throw new UnauthorizedException('M2M authentication required')
      }
      // Observe-only: log what WOULD be rejected, but allow the request
      // through so we can validate consumers before flipping enforcement on.
      this.logger.warn(
        { reason: message },
        'election-api request would be rejected once ELECTION_API_AUTH_ENFORCED=true (observe-only)',
      )
      return true
    }
  }
}
