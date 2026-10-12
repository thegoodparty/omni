import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { Campaign, Outreach, OutreachType } from '@/generated/prisma'
import {
  ContactsFilterResolutionInput,
  ContactsService,
} from '@/contacts/services/contacts.service'
import { ContactInteractionRobocallService } from '@/contactInteraction/services/contactInteractionRobocall.service'
import { ContactInteractionTextService } from '@/contactInteraction/services/contactInteractionText.service'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { PeerlyPhoneListCaptureService } from '@/vendors/peerly/services/peerlyPhoneListCapture.service'
import { VoterFileFilterService } from '@/voters/services/voterFileFilter.service'

// Channels that materialize the resolved filter into per-recipient rows at
// launch. socialMedia has no ContactInteraction<channel> model yet;
// doorKnocking and phoneBanking are permanently excluded — their rows are
// written by the tool/endpoint that logs the contact (a knock, a call), not
// by outreach launch.
const MATERIALIZABLE_OUTREACH_TYPES = new Set<OutreachType>([
  OutreachType.text,
  OutreachType.p2p,
  OutreachType.robocall,
])

// Resolve the segment a page at a time so a large filter never loads whole
// into memory. Every recipient must get a ContactInteraction<channel> row —
// opt-out scrubbing, suppression, history, and response write-back all key
// off it — so pagination always runs to exhaustion by default (see
// `maxRecipients` on the private pagers below; production never overrides
// it, so there is no cap on the total materialized in one launch today).
const SEGMENT_PAGE_SIZE = 1000

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
  // filter, as before — robocall additionally forces hasLandline on the
  // resolved filter (ENG-10803), since only landline numbers are callable.
  async materializeOutreach(
    campaign: Campaign,
    outreach: Outreach,
  ): Promise<void> {
    // Stamped before the channel guard and the row writes: the lock records
    // "this filter drove an outreach", so a channel not materialized here
    // (phoneBanking, socialMedia) still locks. First-write-wins, no
    // rollback — a stamped filter with a
    // partial/failed materialization is still correct. An outreach can
    // carry a phone list without a saved filter (voterFileFilterId is
    // optional on the p2p request), so the captured path below must not
    // be gated on the filter's presence.
    if (outreach.voterFileFilterId) {
      await this.voterFileFilterService.stampFirstUsedForOutreach(
        outreach.voterFileFilterId,
        campaign.organizationSlug,
      )
    }

    if (!MATERIALIZABLE_OUTREACH_TYPES.has(outreach.outreachType)) return

    const occurredAt = new Date()

    // Capture rows only exist for p2p/text phone lists; a robocall that
    // arrives with a phoneListId (the schema doesn't reject the combination)
    // must keep resolving the filter per the feature-5 contract.
    if (
      outreach.phoneListId &&
      outreach.outreachType !== OutreachType.robocall
    ) {
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
      // Both sources exhausted: a silent zero-row launch would look like
      // success. Throw so tryMaterializeOutreach error-logs it instead.
      if (!outreach.voterFileFilterId) {
        throw new Error(
          `Outreach ${outreach.id}: phone list ${outreach.phoneListId} ` +
            'has no captured recipients and no voterFileFilterId to ' +
            'fall back to — cannot materialize',
        )
      }
    }

    if (!outreach.voterFileFilterId) return
    await this.materializeFromFilter(campaign, outreach, occurredAt)
  }

  // Returns the number of rows materialized, or null if the phone list has
  // no capture row — or a capture row with zero recipients — so the caller
  // falls back to the filter instead of silently materializing nothing.
  // `maxRecipients` is a safety-valve hook, not a production behavior: it
  // defaults to unlimited so pagination always runs to exhaustion today.
  // Nothing calls this with an override yet (a real ceiling is future work
  // for the S5 cap lift) — it exists so that work, if it lands, reuses this
  // exact stop condition instead of a new one, and so a regression that
  // reintroduces a silent finite default here can be caught by lowering it
  // in a quick manual check rather than needing a 100k-row test fixture.
  // `pageSize` is the same kind of hook for the N+1 sentinel below: it
  // defaults to the real SEGMENT_PAGE_SIZE, but the multi-page regression
  // test overrides it so a handful of recipients can span multiple
  // findRecipientsPage calls without seeding a 1000+ row fixture.
  private async materializeFromCapture(
    campaign: Campaign,
    outreach: Outreach,
    occurredAt: Date,
    maxRecipients: number = Number.POSITIVE_INFINITY,
    pageSize: number = SEGMENT_PAGE_SIZE,
  ): Promise<number | null> {
    const phoneList = await this.peerlyPhoneListCapture.findFirst({
      where: {
        peerlyListId: outreach.phoneListId,
        // A captured phone list only exists for text/p2p rows, which are
        // always campaign-scoped — only social outreach can be org-only
        // (outreach.prisma).
        campaignId: outreach.campaignId!,
      },
    })
    if (!phoneList) return null

    let skip = 0
    let materialized = 0
    while (materialized < maxRecipients) {
      // Fetch one row past the page size so a full page can tell an exact
      // page-size-multiple list boundary (no more rows) apart from a real
      // next page — findRecipientsPage carries no total-count metadata.
      const page = await this.peerlyPhoneListCapture.findRecipientsPage(
        phoneList.id,
        { skip, take: pageSize + 1 },
      )
      if (page.length === 0) break

      const hasNextPage = page.length > pageSize
      const recipients = hasNextPage ? page.slice(0, pageSize) : page

      const remaining = maxRecipients - materialized
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
      if (materialized >= maxRecipients) {
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

    return materialized === 0 ? null : materialized
  }

  // See the `maxRecipients` note on materializeFromCapture above — same
  // safety-valve hook, same unlimited default, same reasoning.
  private async materializeFromFilter(
    campaign: Campaign,
    outreach: Outreach,
    occurredAt: Date,
    maxRecipients: number = Number.POSITIVE_INFINITY,
  ): Promise<void> {
    const organization = await this.organizations.findFirst({
      where: { slug: campaign.organizationSlug },
    })
    if (!organization) return

    // Guaranteed non-null: materializeOutreach only reaches here once
    // outreach.voterFileFilterId has already been checked truthy.
    const { voterFileFilterId } = outreach
    if (!voterFileFilterId) return

    // Robocall/telemarketing reach landlines, not cell phones (mirrors the
    // CAS fulfillment download's TYPE_OVERRIDES). Force it on the resolved
    // filter regardless of what the saved filter itself carries, so the
    // materialized rows match the callable population the audience step
    // shows (ENG-10803) instead of the whole saved filter.
    const isRobocall = outreach.outreachType === OutreachType.robocall
    let robocallFilter: ContactsFilterResolutionInput | undefined
    if (isRobocall) {
      const filter =
        await this.voterFileFilterService.findByIdAndOrganizationSlug(
          voterFileFilterId,
          campaign.organizationSlug,
        )
      // assertNotLocked (the delete guard) is a read-then-write, not atomic,
      // so a delete request racing this launch's stamp above can still
      // remove the filter row after we've committed to this id. Silently
      // dropping every saved criterion here would materialize the whole
      // district's landline population instead of the intended audience —
      // fail loudly so tryMaterializeOutreach error-logs it instead.
      if (!filter) {
        throw new Error(
          `Outreach ${outreach.id}: voterFileFilter ${voterFileFilterId} ` +
            `not found for org ${campaign.organizationSlug} — cannot ` +
            'materialize robocall without filter context',
        )
      }
      robocallFilter = { ...filter, hasLandline: true }
    }

    const segment = String(voterFileFilterId)

    let page = 1
    let materialized = 0
    while (materialized < maxRecipients) {
      const { people, pagination } = robocallFilter
        ? await this.contacts.findContactsForFilter(
            robocallFilter,
            { resultsPerPage: SEGMENT_PAGE_SIZE, page },
            organization,
          )
        : await this.contacts.findContacts(
            { segment, resultsPerPage: SEGMENT_PAGE_SIZE, page },
            organization,
          )
      if (people.length === 0) break

      const remaining = maxRecipients - materialized
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
      if (materialized >= maxRecipients) {
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
