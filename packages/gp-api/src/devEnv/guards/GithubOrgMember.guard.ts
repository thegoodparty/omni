import {
  BadGatewayException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { IS_NON_PROD_DEPLOY } from '@/shared/util/appEnvironment.util'
import { DevEnvRequest } from '../devEnv.types'
import {
  GithubMembership,
  GithubMembershipSchema,
} from '../schemas/githubMembership.schema'

export const GITHUB_ORG = 'thegoodparty'
const MEMBERSHIP_URL = `https://api.github.com/user/memberships/orgs/${GITHUB_ORG}`
const ACTIVE_MEMBERSHIP_STATE = 'active'
const GITHUB_TIMEOUT_MS = 10_000
const GITHUB_UNREACHABLE = 'Could not reach GitHub'
const BEARER_PREFIX = 'Bearer '

// Authorizes a caller purely on "is an active member of the thegoodparty
// GitHub org" — the one credential a brand-new contributor already has. The
// bearer token is a GitHub user token, is spent on this single membership
// call, and is never persisted, logged, or sent anywhere else.
//
// Rejections are deliberately detail-free: the caller learns that it was
// refused, not whether the token was bad, expired, unscoped, or simply not a
// member's.
@Injectable()
export class GithubOrgMemberGuard implements CanActivate {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(GithubOrgMemberGuard.name)
  }

  async canActivate(context: ExecutionContext) {
    // The controller repeats this gate, but a guard runs first: without it a
    // prod request would answer 401 (proving the route exists) and would ship
    // an attacker-supplied token to api.github.com before the handler's 404.
    if (!IS_NON_PROD_DEPLOY) {
      throw new NotFoundException()
    }

    const req = context.switchToHttp().getRequest<DevEnvRequest>()
    const authorization = req.headers.authorization

    if (!authorization?.startsWith(BEARER_PREFIX)) {
      throw new UnauthorizedException()
    }

    const membership = await this.fetchMembership(
      authorization.slice(BEARER_PREFIX.length),
    )

    if (membership.state !== ACTIVE_MEMBERSHIP_STATE) {
      throw new ForbiddenException()
    }

    req.githubLogin = membership.user.login
    return true
  }

  private async fetchMembership(token: string): Promise<GithubMembership> {
    let response: Response
    try {
      response = await fetch(MEMBERSHIP_URL, {
        headers: {
          Authorization: `${BEARER_PREFIX}${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
      })
    } catch (err) {
      this.logger.error({ err }, 'GitHub membership check could not be made')
      throw new BadGatewayException(GITHUB_UNREACHABLE)
    }

    const status: HttpStatus = response.status
    if (status === HttpStatus.UNAUTHORIZED) {
      throw new UnauthorizedException()
    }

    // 404 is GitHub's answer for "not a member of that org" as much as for
    // "this token cannot see it", and 403 covers a blocked or unscoped token.
    // All of those are one refusal, and none of the reasons is echoed back.
    if (status === HttpStatus.FORBIDDEN || status === HttpStatus.NOT_FOUND) {
      throw new ForbiddenException()
    }

    if (!response.ok) {
      this.logger.error(
        { status: response.status },
        'GitHub membership check failed',
      )
      throw new BadGatewayException(GITHUB_UNREACHABLE)
    }

    const membership = await this.readMembership(response)
    if (!membership) {
      throw new BadGatewayException(GITHUB_UNREACHABLE)
    }
    return membership
  }

  private async readMembership(response: Response) {
    let parsed: ReturnType<typeof GithubMembershipSchema.safeParse>
    try {
      parsed = GithubMembershipSchema.safeParse(await response.json())
    } catch (err) {
      this.logger.error({ err }, 'GitHub membership response was not JSON')
      return null
    }

    if (!parsed.success) {
      this.logger.error(
        { err: parsed.error },
        'GitHub membership response had an unexpected shape',
      )
      return null
    }
    return parsed.data
  }
}
