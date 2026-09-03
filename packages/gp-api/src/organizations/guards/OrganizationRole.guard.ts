import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { OrganizationRole } from '../../generated/prisma'
import { ALLOW_VOLUNTEER_KEY } from '../decorators/AllowVolunteer.decorator'
import { OWNER_ONLY_KEY } from '../decorators/OwnerOnly.decorator'

const MANAGER_OR_ABOVE: OrganizationRole[] = [
  OrganizationRole.owner,
  OrganizationRole.campaignAdmin,
]

/**
 * Route-level guard enforcing the team-role line on org-scoped routes.
 *
 * Must run AFTER a scoping guard (UseOrganizationGuard / UseCampaignGuard)
 * has attached `request.organizationRole` — it never resolves a role
 * itself. Append it to a decorator's `UseGuards(...)` list, not register it
 * standalone.
 *
 * Semantics:
 * - no `@OwnerOnly()` / `@AllowVolunteer()`: owner or campaignAdmin
 * - `@OwnerOnly()`: owner only
 * - `@AllowVolunteer()`: any resolved member, including volunteer
 * - `request.organizationRole` unset (no scoping guard ran, or it ran with
 *   `continueIfNotFound` and found nothing): pass through unchanged —
 *   this guard only gates routes that actually have org context.
 */
@Injectable()
export class OrganizationRoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<{ organizationRole?: OrganizationRole }>()

    const role = request.organizationRole
    if (!role) return true

    const ownerOnly = this.reflector.getAllAndOverride<boolean>(
      OWNER_ONLY_KEY,
      [context.getHandler(), context.getClass()],
    )
    if (ownerOnly) {
      if (role === OrganizationRole.owner) return true
      throw new ForbiddenException('Organization owner access required')
    }

    // Volunteer memberships don't exist yet — every scoping guard fails
    // closed on them before this guard ever sees `role === volunteer`. This
    // branch is unreachable end-to-end today; it is unit-tested directly so
    // Phase 1.5 (which opens specific surfaces by loosening those guards)
    // lands on an already-proven admission path.
    const allowVolunteer = this.reflector.getAllAndOverride<boolean>(
      ALLOW_VOLUNTEER_KEY,
      [context.getHandler(), context.getClass()],
    )
    if (allowVolunteer) return true

    if (MANAGER_OR_ABOVE.includes(role)) return true

    throw new ForbiddenException('Organization manager access required')
  }
}
