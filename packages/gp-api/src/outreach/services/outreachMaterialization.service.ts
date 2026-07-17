import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { Campaign, Outreach, OutreachType } from '@/generated/prisma'
import { ContactsService } from '@/contacts/services/contacts.service'
import { ContactInteractionRobocallService } from '@/contactInteraction/services/contactInteractionRobocall.service'
import { ContactInteractionTextService } from '@/contactInteraction/services/contactInteractionText.service'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { VoterFileFilterService } from '@/voters/services/voterFileFilter.service'

// Channels that materialize the resolved filter into per-recipient rows at
// launch. phoneBanking/socialMedia have no ContactInteraction<channel> model
// yet (task 15 of the epic); doorKnocking is permanently excluded — its rows
// are written by the tool that performs the knock, not by outreach launch.
const MATERIALIZABLE_OUTREACH_TYPES = new Set<OutreachType>([
  OutreachType.text,
  OutreachType.p2p,
  OutreachType.robocall,
])

// Mirrors OutreachAttributionService's paging: resolve the segment a page at
// a time so a large filter never loads whole into memory, and cap the total
// materialized in one launch.
const SEGMENT_PAGE_SIZE = 1000
const MAX_MATERIALIZED_VOTERS = 100_000

@Injectable()
export class OutreachMaterializationService {
  constructor(
    private readonly contacts: ContactsService,
    private readonly organizations: OrganizationsService,
    private readonly voterFileFilterService: VoterFileFilterService,
    private readonly textInteractions: ContactInteractionTextService,
    private readonly robocallInteractions: ContactInteractionRobocallService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OutreachMaterializationService.name)
  }

  // Resolves the outreach's saved filter (task 05's activity-condition-aware
  // findContacts) into one ContactInteraction<channel> row per person and
  // locks the filter from further edits. The rows are the audit trail for
  // this launch — sourced from the resolved filter, not the actual
  // SMS-reachable Peerly phone list, so they knowingly overstate true
  // recipients the same way today's segment-derived attribution does;
  // feature 5 corrects the source. `occurredAt` is launch time (when this
  // runs), not send-completion time.
  async materializeOutreach(
    campaign: Campaign,
    outreach: Outreach,
  ): Promise<void> {
    if (!outreach.voterFileFilterId) return
    if (!MATERIALIZABLE_OUTREACH_TYPES.has(outreach.outreachType)) return

    const organization = await this.organizations.findFirst({
      where: { slug: campaign.organizationSlug },
    })
    if (!organization) return

    // Stamped before the row writes, first-write-wins, no rollback: a
    // stamped filter with a partial/failed materialization is still correct
    // — first use is a fact even if this launch's rows don't all land.
    await this.voterFileFilterService.stampFirstUsedForOutreach(
      outreach.voterFileFilterId,
      campaign.organizationSlug,
    )

    const segment = String(outreach.voterFileFilterId)
    const occurredAt = new Date()

    let page = 1
    let materialized = 0
    while (materialized < MAX_MATERIALIZED_VOTERS) {
      const { people, pagination } = await this.contacts.findContacts(
        { segment, resultsPerPage: SEGMENT_PAGE_SIZE, page },
        organization,
      )
      if (people.length === 0) break

      const remaining = MAX_MATERIALIZED_VOTERS - materialized
      const truncatedThisPage = people.length > remaining
      const batch = people.slice(0, remaining).map((person) => ({
        organizationSlug: campaign.organizationSlug,
        personId: person.id,
        outreachId: outreach.id,
        occurredAt,
      }))

      await this.writeBatch(outreach.outreachType, batch)
      materialized += batch.length

      const hasMore = truncatedThisPage || pagination.hasNextPage
      if (!hasMore) break
      if (materialized >= MAX_MATERIALIZED_VOTERS) {
        this.logger.warn(
          {
            outreachId: outreach.id,
            filterId: outreach.voterFileFilterId,
            materialized,
            totalResults: pagination.totalResults,
          },
          'Outreach materialization hit the per-launch cap; remaining ' +
            'people in the resolved filter were not materialized',
        )
        break
      }
      page += 1
    }
  }

  private writeBatch(
    outreachType: OutreachType,
    batch: {
      organizationSlug: string
      personId: string
      outreachId: number
      occurredAt: Date
    }[],
  ) {
    return outreachType === OutreachType.robocall
      ? this.robocallInteractions.createManyIdempotent(batch)
      : this.textInteractions.createManyIdempotent(batch)
  }
}
