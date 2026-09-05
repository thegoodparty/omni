import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Organization, OrganizationRole } from '../../generated/prisma'
import { PinoLogger } from 'nestjs-pino'
import {
  REQUIRE_ORGANIZATION_META_KEY,
  RequireOrganizationMetadata,
} from '../decorators/UseOrganization.decorator'
import { OrganizationMembershipService } from '../services/organizationMembership.service'

/**
 * Guard that resolves an Organization from the `X-Organization-Slug` header.
 *
 * Used when you need Organization data directly (positionId, overrideDistrictId, etc.).
 * For ElectedOffice or Campaign context, use @UseElectedOffice() or @UseCampaign()
 * instead — those guards also resolve via the `X-Organization-Slug` header.
 *
 * Resolution:
 * 1. Read `X-Organization-Slug` header.
 * 2. Resolve a role for the org: owner fallback, else a membership row.
 * 3. Attach the organization + role to the request for `@ReqOrganization()`
 *    / `@ReqOrganizationRole()`.
 *
 * Metadata options (set via `@UseOrganization()`):
 * - `continueIfNotFound` — if true, allows the request to proceed without an organization.
 */
@Injectable()
export class UseOrganizationGuard implements CanActivate {
  constructor(
    private readonly organizationMembership: OrganizationMembershipService,
    private readonly reflector: Reflector,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(UseOrganizationGuard.name)
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>
      user?: { id: number }
      organization?: Organization
      organizationRole?: OrganizationRole
    }>()

    const { continueIfNotFound } =
      this.reflector.getAllAndOverride<RequireOrganizationMetadata>(
        REQUIRE_ORGANIZATION_META_KEY,
        [context.getHandler(), context.getClass()],
      ) ?? {}

    // This guard can sit on @PublicAccess routes (e.g. onboarding stats),
    // where unauthenticated requests have no user — treat that like a
    // missing slug instead of crashing on the property access.
    const userId = request.user?.id
    const slug = request.headers['x-organization-slug']

    if (!slug || !userId) {
      if (continueIfNotFound) return true
      this.logger.info('No organization slug header provided')
      throw new NotFoundException('Organization not found')
    }

    const resolved = await this.organizationMembership.resolveRole(slug, userId)

    // This guard only resolves and attaches — it doesn't gate on role.
    // OrganizationRoleGuard (next in @UseOrganization()'s guard chain)
    // enforces the team-role line, so a volunteer reaches it as a resolved
    // member and gets a 403 there, not a 404 here.
    if (resolved) {
      request.organization = resolved.organization
      request.organizationRole = resolved.role
      return true
    } else if (continueIfNotFound) {
      return true
    }

    this.logger.info(
      { slug, userId },
      'Organization not found or not owned by user',
    )
    throw new NotFoundException('Organization not found')
  }
}
