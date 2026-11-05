import { Injectable } from '@nestjs/common'
import { SERVE_IMPORT_CONTACTS_FLAG } from '@goodparty_org/contracts'
import { FeaturesService } from '@/features/services/features.service'
import { PositionsService } from '@/electionDb/positions/positions.service'
import { Organization } from '@/generated/prisma'
import { PrismaService } from '@/prisma/prisma.service'

export type PeopleDataset = {
  base: 'voters' | 'constituents'
  overlayOrgSlug?: string
  overlayDistrictId?: string
}

export const SERVE_CONSUMER_DATA_FLAG = 'serve-consumer-data'

@Injectable()
export class PeopleDatasetService {
  constructor(
    private readonly features: FeaturesService,
    private readonly positions: PositionsService,
    private readonly prisma: PrismaService,
  ) {}

  // Checked against the org owner, not the acting user, so team members,
  // queue jobs and chats acting for one org always land on the same people.
  resolve = async (
    organization: Pick<
      Organization,
      'slug' | 'ownerId' | 'overrideDistrictId' | 'positionId'
    >,
  ): Promise<PeopleDataset> => {
    const isServe = organization.slug.startsWith('eo-')
    const [consumerData, importContacts] = await Promise.all([
      isServe &&
        this.features.isFeatureEnabled({
          user: organization.ownerId,
          feature: SERVE_CONSUMER_DATA_FLAG,
        }),
      this.features.isFeatureEnabled({
        user: organization.ownerId,
        feature: SERVE_IMPORT_CONTACTS_FLAG,
      }),
    ])
    const base = consumerData ? 'constituents' : 'voters'
    if (!importContacts) return { base }
    // The overlay view reads Postgres through federation, and Databricks
    // caches no federated read, so the join makes every read run in full
    // even when it adds nobody. Join only an org the view has a row for: the
    // view's own condition, read live so an upload shows on the next read,
    // and answered by the (organizationSlug, personId) index.
    if (!(await this.hasImportedContacts(organization.slug))) return { base }
    // The same district ContactsService.resolveDistrictInfoFromOrg resolves,
    // read here because ContactsService depends on this service.
    const position =
      !organization.overrideDistrictId && organization.positionId
        ? await this.positions.getPositionById({
            id: organization.positionId,
            includeDistrict: true,
          })
        : null
    return {
      base,
      overlayOrgSlug: organization.slug,
      overlayDistrictId:
        organization.overrideDistrictId ?? position?.district?.id,
    }
  }

  private hasImportedContacts = async (slug: string): Promise<boolean> =>
    (await this.prisma.contactUploadMatch.findFirst({
      where: { organizationSlug: slug, personId: { not: null } },
      select: { id: true },
    })) !== null
}
