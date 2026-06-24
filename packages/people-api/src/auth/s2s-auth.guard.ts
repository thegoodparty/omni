import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { IS_PUBLIC_KEY } from './public.decorator'
import jwt from 'jsonwebtoken'

/**
 * Server-to-server authentication guard.
 * Accepts a Bearer token signed with PEOPLE_API_S2S_SECRET by gp-api.
 * Allows localhost access if S2S_ALLOW_LOCALHOST is truthy (for dev only).
 */
@Injectable()
export class S2SAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ])
    if (isPublic) {
      return true
    }

    const request = context.switchToHttp().getRequest()

    // Prefer validating Authorization header when present, even on localhost
    const authHeader: string | undefined = request.headers['authorization']
    if (authHeader) {
      const [scheme, token] = authHeader.split(' ')
      if (!/^Bearer$/i.test(scheme) || !token) {
        throw new UnauthorizedException('Invalid Authorization format')
      }

      const secret = process.env.PEOPLE_API_S2S_SECRET
      if (!secret) {
        throw new UnauthorizedException('S2S secret not configured')
      }

      try {
        // Pin the algorithm (a string secret already restricts jsonwebtoken to
        // HMAC, but pin it explicitly), bind issuer/audience to the gp-api↔
        // people-api pair, and enforce a bounded lifetime via maxAge so a token
        // minted without (or with a far-future) exp can't be replayed
        // indefinitely — jsonwebtoken only checks exp when present (CWE-613).
        const payload = jwt.verify(token, secret, {
          algorithms: ['HS256'],
          issuer: 'gp-api',
          audience: 'people-api',
          maxAge: '5m',
        })
        request.s2s = payload
        return true
      } catch (err) {
        throw new UnauthorizedException('Invalid or expired token')
      }
    }

    // Optional localhost bypass for development/testing only if no header
    // provided. Trust ONLY the real connection address: request.ip is the raw
    // socket address (the Fastify adapter sets no trustProxy, so it is not
    // taken from X-Forwarded-For). request.hostname is derived from the
    // attacker-controllable Host header and must NOT gate auth — sending
    // `Host: localhost` would otherwise skip S2S verification entirely
    // (CWE-290).
    if (
      process.env.S2S_ALLOW_LOCALHOST &&
      // Anchored group — without the parens the alternation binds as
      // (^true)|(1)|(yes$), so e.g. `false1` would wrongly enable the bypass.
      /^(true|1|yes)$/i.test(process.env.S2S_ALLOW_LOCALHOST) &&
      (request.ip === '127.0.0.1' ||
        request.ip === '::1' ||
        request.ip === '::ffff:127.0.0.1')
    ) {
      return true
    }

    throw new UnauthorizedException('Missing Authorization header')
  }
}
