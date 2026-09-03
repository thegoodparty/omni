import { Injectable } from '@nestjs/common'
import { Organization, OrganizationRole } from '../../generated/prisma'
import { createPrismaBase, MODELS } from 'src/prisma/util/prisma.util'

export type ResolvedOrganizationRole = {
  role: OrganizationRole
  organization: Organization
}

@Injectable()
export class OrganizationMembershipService extends createPrismaBase(
  MODELS.OrganizationMembership,
) {
  // Owner-fallback-then-membership: the one place that knows both authz
  // shapes so the guards never re-implement the fallback order themselves.
  // Owner path stays a single query; only a non-owner pays for the second.
  // Resolves a volunteer's real role rather than denying it here — every
  // caller must decide for itself whether volunteer is admitted (Phase 1.5
  // opens specific surfaces deliberately; today every guard denies it).
  async resolveRole(
    slug: string,
    userId: number,
  ): Promise<ResolvedOrganizationRole | null> {
    const organization = await this.client.organization.findUnique({
      where: { slug },
    })
    if (!organization) return null

    if (organization.ownerId === userId) {
      return { role: OrganizationRole.owner, organization }
    }

    const membership = await this.model.findUnique({
      where: { organizationSlug_userId: { organizationSlug: slug, userId } },
    })
    if (!membership) return null

    return { role: membership.role, organization }
  }
}
