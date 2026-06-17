import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import {
  Campaign,
  Outreach,
  OutreachType,
  User,
  VoterOutreachAttributionSource,
} from '@/generated/prisma'
import { ContactsService } from '@/contacts/services/contacts.service'
import { FeaturesService } from '@/features/services/features.service'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { VoterOutreachActivityService } from '@/voterOutreachActivity/services/voterOutreachActivity.service'

const WIN_VOTER_DATA_FEATURE_FLAG = 'win-voter-data'

// Per-voter attribution source by outreach channel, resolved through the same
// segment the outreach targeted. p2p uploads an explicit per-recipient list to
// Peerly, so its voters are recipient-confirmed; the other channels have no
// per-recipient confirmation (the resolved segment IS the recipient list), so
// they are segment-derived. p2p + text are owned by this epic task (14),
// phoneBanking/robocall/socialMedia by task 15. doorKnocking is omitted — it
// records its own per-recipient activities keyed on the upstream event (task 13).
const ATTRIBUTION_SOURCE_BY_OUTREACH_TYPE: Partial<
  Record<OutreachType, VoterOutreachAttributionSource>
> = {
  [OutreachType.p2p]: VoterOutreachAttributionSource.recipient,
  [OutreachType.text]: VoterOutreachAttributionSource.segmentDerived,
  [OutreachType.phoneBanking]: VoterOutreachAttributionSource.segmentDerived,
  [OutreachType.robocall]: VoterOutreachAttributionSource.segmentDerived,
  [OutreachType.socialMedia]: VoterOutreachAttributionSource.segmentDerived,
}

// Resolve the segment a page at a time so a large segment never loads whole
// into memory, and cap the total attributed in one launch. The cap bounds the
// synchronous work on this highest-volume write path; a segment past it is
// tagged up to the cap and the shortfall is logged rather than silently
// dropped.
const SEGMENT_PAGE_SIZE = 1000
const MAX_SEGMENT_ATTRIBUTION_VOTERS = 100_000

@Injectable()
export class OutreachAttributionService {
  constructor(
    private readonly contacts: ContactsService,
    private readonly activities: VoterOutreachActivityService,
    private readonly organizations: OrganizationsService,
    private readonly features: FeaturesService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OutreachAttributionService.name)
  }

  // Emit one VoterOutreachActivity per voter in the launched outreach's resolved
  // segment, sourced per channel (p2p = recipient, others = segmentDerived).
  // Gated by win-voter-data (the epic's rollout flag) and only meaningful when
  // the outreach targets a saved segment. Idempotent on (outreachId, lalVoterId)
  // so a relaunch/retry can't double-tag a voter.
  async recordSegmentAttribution(
    user: User,
    campaign: Campaign,
    outreach: Outreach,
  ): Promise<void> {
    const attributionSource =
      ATTRIBUTION_SOURCE_BY_OUTREACH_TYPE[outreach.outreachType]
    if (!attributionSource) return
    if (!outreach.voterFileFilterId) return

    const flagEnabled = await this.features.isFeatureEnabled({
      user,
      feature: WIN_VOTER_DATA_FEATURE_FLAG,
    })
    if (!flagEnabled) return

    const organization = await this.organizations.findFirst({
      where: { slug: campaign.organizationSlug },
    })
    if (!organization) return

    const segment = String(outreach.voterFileFilterId)
    const occurredAt = outreach.date ?? outreach.createdAt

    let page = 1
    let recorded = 0
    while (recorded < MAX_SEGMENT_ATTRIBUTION_VOTERS) {
      const { people, pagination } = await this.contacts.findContacts(
        { segment, resultsPerPage: SEGMENT_PAGE_SIZE, page },
        organization,
      )
      if (people.length === 0) break

      const remaining = MAX_SEGMENT_ATTRIBUTION_VOTERS - recorded
      const truncatedThisPage = people.length > remaining
      const batch = people.slice(0, remaining).map((person) => ({
        campaignId: campaign.id,
        lalVoterId: person.lalVoterId,
        outreachType: outreach.outreachType,
        attributionSource,
        occurredAt,
        outreachId: outreach.id,
      }))

      await this.activities.recordSegmentActivities(batch)
      recorded += batch.length

      const hasMore = truncatedThisPage || pagination.hasNextPage
      if (!hasMore) break
      if (recorded >= MAX_SEGMENT_ATTRIBUTION_VOTERS) {
        this.logger.warn(
          {
            outreachId: outreach.id,
            campaignId: campaign.id,
            recorded,
            totalResults: pagination.totalResults,
          },
          'Segment attribution hit the per-launch cap; remaining voters in ' +
            'the segment were not tagged',
        )
        break
      }
      page += 1
    }
  }
}
