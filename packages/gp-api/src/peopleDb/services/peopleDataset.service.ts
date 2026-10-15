import { Injectable } from '@nestjs/common'
import { FeaturesService } from '@/features/services/features.service'
import { Organization } from '@/generated/prisma'

export type PeopleDataset = 'voters' | 'constituents'

export const SERVE_CONSUMER_DATA_FLAG = 'serve-consumer-data'

@Injectable()
export class PeopleDatasetService {
  constructor(private readonly features: FeaturesService) {}

  // Checked against the org owner, not the acting user, so team members,
  // queue jobs and chats acting for one org always land on the same people.
  resolve = async (
    organization: Pick<Organization, 'slug' | 'ownerId'>,
  ): Promise<PeopleDataset> => {
    if (!organization.slug.startsWith('eo-')) return 'voters'
    const enabled = await this.features.isFeatureEnabled({
      user: organization.ownerId,
      feature: SERVE_CONSUMER_DATA_FLAG,
    })
    return enabled ? 'constituents' : 'voters'
  }
}
