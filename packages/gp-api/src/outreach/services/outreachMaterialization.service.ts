import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { Campaign, Outreach, OutreachType } from '@/generated/prisma'
import { ContactsService } from '@/contacts/services/contacts.service'
import { ContactInteractionRobocallService } from '@/contactInteraction/services/contactInteractionRobocall.service'
import { ContactInteractionTextService } from '@/contactInteraction/services/contactInteractionText.service'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { PeerlyPhoneListCaptureService } from '@/vendors/peerly/services/peerlyPhoneListCapture.service'
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
    private readonly peerlyPhoneListCapture: PeerlyPhoneListCaptureService,
    private readonly textInteractions: ContactInteractionTextService,
    private readonly robocallInteractions: ContactInteractionRobocallService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(OutreachMaterializationService.name)
  }

  // Resolves the outreach into one ContactInteraction<channel> row per
  // person and locks the filter from further edits. `occurredAt` is launch
  // time (when this runs), not send-completion time.
  //
  // For a p2p/text outreach with a captured Peerly phone list (feature 5),
  // rows are sourced from the captured recipients — the actual
  // SMS-reachable list — rather than the saved filter, so they no longer
  // overstate true recipients. The remaining gap: an outreach with a
  // phoneListId but no capture rows (a list built before this epic shipped,
  // or one whose capture write failed) falls back to resolving the filter
  // fresh, which can still drift from the list Peerly actually sent to.
  // Robocall and any outreach without a phoneListId always resolve the
  // filter, as before.
  async materializeOutreach(
    campaign: Campaign,
    outreach: Outreach,
  ): Promise<void> {
    if (!outreach.voterFileFilterId) return

    // Stamped before the channel guard and the row writes: the lock records
    // "this filter drove an outreach", so channels without a
    // ContactInteraction model (phoneBanking, socialMedia) still lock.
    // First-write-wins, no rollback — a stamped filter with a
    // partial/failed materialization is still correct.
    await this.voterFileFilterService.stampFirstUsedForOutreach(
      outreach.voterFileFilterId,
      campaign.organizationSlug,
    )

    if (!MATERIALIZABLE_OUTREACH_TYPES.has(outreach.outreachType)) return

    const occurredAt = new Date()

    if (outreach.phoneListId) {
      const materialized = await this.materializeFromCapture(
        campaign,
        outreach,
        occurredAt,
      )
      if (materialized !== null) {
        this.logger.info(
          {
            outreachId: outreach.id,
            phoneListId: outreach.phoneListId,
            materialized,
            source: 'captured',
          },
          'Outreach materialized from captured phone-list recipients',
        )
        return
      }

      this.logger.warn(
        { outreachId: outreach.id, phoneListId: outreach.phoneListId },
        'No captured recipients for this phone list (built before ' +
          'capture shipped, or the capture write failed); falling back ' +
          'to filter resolution',
      )
    }

    await this.materializeFromFilter(campaign, outreach, occurredAt)
  }

  // Returns the number of rows materialized, or null if the phone list has
  // no capture row yet — the caller's signal to fall back to the filter.
  private async materializeFromCapture(
    campaign: Campaign,
    outreach: Outreach,
    occurredAt: Date,
  ): Promise<number | null> {
    const phoneList = await this.peerlyPhoneListCapture.findFirst({
      where: {
        peerlyListId: outreach.phoneListId,
        campaignId: outreach.campaignId,
      },
    })
    if (!phoneList) return null

    let skip = 0
    let materialized = 0
    while (materialized < MAX_MATERIALIZED_VOTERS) {
      // Fetch one row past the page size so a full page can tell an exact
      // page-size-multiple list boundary (no more rows) apart from a real
      // next page — findRecipientsPage carries no total-count metadata.
      const page = await this.peerlyPhoneListCapture.findRecipientsPage(
        phoneList.id,
        { skip, take: SEGMENT_PAGE_SIZE + 1 },
      )
      if (page.length === 0) break

      const hasNextPage = page.length > SEGMENT_PAGE_SIZE
      const recipients = hasNextPage ? page.slice(0, SEGMENT_PAGE_SIZE) : page

      const remaining = MAX_MATERIALIZED_VOTERS - materialized
      const truncatedThisPage = recipients.length > remaining
      const batch = recipients.slice(0, remaining).map((recipient) => ({
        organizationSlug: campaign.organizationSlug,
        personId: recipient.personId,
        outreachId: outreach.id,
        occurredAt,
      }))

      await this.writeBatch(outreach.outreachType, batch)
      materialized += batch.length
      skip += recipients.length

      const hasMore = truncatedThisPage || hasNextPage
      if (!hasMore) break
      if (materialized >= MAX_MATERIALIZED_VOTERS) {
        this.logger.warn(
          {
            outreachId: outreach.id,
            phoneListId: outreach.phoneListId,
            materialized,
          },
          'Outreach materialization hit the per-launch cap reading ' +
            'captured recipients; remaining recipients were not ' +
            'materialized',
        )
        break
      }
    }

    return materialized
  }

  private async materializeFromFilter(
    campaign: Campaign,
    outreach: Outreach,
    occurredAt: Date,
  ): Promise<void> {
    const organization = await this.organizations.findFirst({
      where: { slug: campaign.organizationSlug },
    })
    if (!organization) return

    const segment = String(outreach.voterFileFilterId)

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

    this.logger.info(
      {
        outreachId: outreach.id,
        filterId: outreach.voterFileFilterId,
        materialized,
        source: 'filter-resolved',
      },
      'Outreach materialized from resolved filter',
    )
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
