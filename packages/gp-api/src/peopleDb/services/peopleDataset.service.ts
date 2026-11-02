import { Injectable } from '@nestjs/common'
import { SERVE_IMPORT_CONTACTS_FLAG } from '@goodparty_org/contracts'
import { FeaturesService } from '@/features/services/features.service'
import { PositionsService } from '@/electionDb/positions/positions.service'
import { Organization } from '@/generated/prisma'

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
}
