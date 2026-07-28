import {
  BadGatewayException,
  BadRequestException,
  HttpException,
  Injectable,
} from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { Campaign, Organization } from '../../../generated/prisma'
import { CampaignTcrComplianceService } from '../../../campaigns/tcrCompliance/services/campaignTcrCompliance.service'
import { MAX_RESOLVED_ID_SET_SIZE } from '@/contactInteraction/services/activityConditionResolution.service'
import { ContactInteractionTextService } from '@/contactInteraction/services/contactInteractionText.service'
import {
  ContactsFilterResolutionInput,
  ContactsService,
} from '@/contacts/services/contacts.service'
import { csvEscape } from '@/shared/util/csv.util'
import { OrganizationsService } from '../../../organizations/services/organizations.service'
import { P2pPhoneListRequestSchema } from '../schemas/p2pPhoneListRequest.schema'
import { PeerlyPhoneListCaptureService } from './peerlyPhoneListCapture.service'
import { PeerlyPhoneListService } from './peerlyPhoneList.service'
import { VoterFileFilterService } from '@/voters/services/voterFileFilter.service'

// Mirrors outreachMaterialization.service.ts's paging shape. Not shared as an
// export — each contacts-pipeline consumer keeps its own copy (see that
// file's SEGMENT_PAGE_SIZE for the sibling constant).
const SEGMENT_PAGE_SIZE = 1000
const MAX_PHONE_LIST_RECIPIENTS = 100_000
const MAX_PHONE_LIST_PAGES =
  Math.ceil(MAX_PHONE_LIST_RECIPIENTS / SEGMENT_PAGE_SIZE) + 1

const CSV_HEADER_ROW = 'first_name,last_name,lead_phone,state,city,zip'

type PhoneListRecipient = { personId: string; phone: string }

@Injectable()
export class P2pPhoneListUploadService {
  constructor(
    private readonly contactsService: ContactsService,
    private readonly organizationsService: OrganizationsService,
    private readonly peerlyPhoneListService: PeerlyPhoneListService,
    private readonly peerlyPhoneListCapture: PeerlyPhoneListCaptureService,
    private readonly tcrComplianceService: CampaignTcrComplianceService,
    private readonly voterFileFilterService: VoterFileFilterService,
    private readonly contactInteractionTextService: ContactInteractionTextService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(P2pPhoneListUploadService.name)
  }

  async uploadPhoneList(
    campaign: Campaign,
    request: P2pPhoneListRequestSchema,
  ): Promise<{ token: string; listName: string }> {
    const { name: listName, ...filterInput } = request

    const tcrCompliance = await this.tcrComplianceService.fetchByCampaignId(
      campaign.id,
    )

    if (!tcrCompliance || !tcrCompliance.peerlyIdentityId) {
      throw new BadRequestException(
        'TCR compliance record does not have a Peerly identity ID',
      )
    }

    const organization = await this.organizationsService.findFirst({
      where: { slug: campaign.organizationSlug },
    })
    if (!organization) {
      throw new BadRequestException('Organization not found for campaign')
    }

    // Texting is a Pro feature — PII exposure stays bounded by the Pro gate
    // (isProAccess, enforced inside findContactsForFilter below).
    // Product decision (Tomer, 2026-07-18): ENG-10741.

    let resolvedFilterInput: ContactsFilterResolutionInput = filterInput
    if (filterInput.voterFileFilterId) {
      const filter =
        await this.voterFileFilterService.findByIdAndOrganizationSlug(
          filterInput.voterFileFilterId,
          campaign.organizationSlug,
        )
      if (!filter) {
        throw new BadRequestException('Voter file filter not found')
      }
      // The saved segment's persisted criteria are the base and explicit
      // inline fields override — mirroring how getListDetail resolves a
      // persisted filter. Without this the id would be captured while the
      // list silently ran against the whole district.
      resolvedFilterInput = { ...filter, ...filterInput }
    }

    const excludePersonIds = await this.resolveOptOutScrub(
      campaign.organizationSlug,
    )

    let phoneList: {
      csvBuffer: Buffer
      recipients: PhoneListRecipient[]
      excludedDuplicatePhoneCount: number
    }
    try {
      phoneList = await this.buildPhoneList(
        resolvedFilterInput,
        organization,
        excludePersonIds,
      )
    } catch (error) {
      if (error instanceof HttpException) {
        this.logger.warn(
          { error },
          `CSV generation rejected for campaign ${campaign.id} (HttpException passthrough)`,
        )
        throw error
      }
      this.logger.error(
        { error },
        `Failed to generate voter data for phone list, campaign ${campaign.id}:`,
      )
      throw new BadRequestException(
        'Failed to generate voter data for phone list',
      )
    }
    const { csvBuffer, recipients, excludedDuplicatePhoneCount } = phoneList
    if (recipients.length === 0) {
      throw new BadRequestException(
        'No contacts matched the filter with a valid phone number and ' +
          'complete address — narrow the filter or check your contact data.',
      )
    }

    let token: string
    try {
      token = await this.peerlyPhoneListService.uploadPhoneList({
        listName,
        csvBuffer,
        identityId: tcrCompliance.peerlyIdentityId,
      })
    } catch (error) {
      this.logger.error(
        { error },
        `Failed to upload phone list to Peerly for campaign ${campaign.id}:`,
      )
      throw new BadGatewayException(
        'Failed to upload phone list to Peerly platform',
      )
    }

    // Capture rows are only written once Peerly confirms it has the list —
    // both throws above happen before this line, so a list Peerly never
    // received can never gain capture rows.
    //
    // The reported count is the candidate opt-out set size, not a
    // post-composition truth: if this org's support-status "unknown"
    // notIn resolution is itself large, ContactsService may drop the
    // opt-out merge to stay under people-api's id-filter cap
    // (excludePersonIdsFromResolution) — logged loudly there, but this
    // count won't reflect it. Rare (both sets have to be near-cap at
    // once) and acceptable for the observability this column exists for.
    await this.peerlyPhoneListCapture.recordUpload({
      organizationSlug: campaign.organizationSlug,
      campaignId: campaign.id,
      token,
      voterFileFilterId: filterInput.voterFileFilterId ?? null,
      recipients,
      excludedOptedOutCount: excludePersonIds.size,
      excludedDuplicatePhoneCount,
    })

    this.logger.debug(
      `P2P phone list uploaded successfully for campaign ${campaign.id}, token: ${token}`,
    )

    return { token, listName }
  }

  private async buildPhoneList(
    filterInput: ContactsFilterResolutionInput,
    organization: Organization,
    excludePersonIds: Set<string>,
  ): Promise<{
    csvBuffer: Buffer
    recipients: PhoneListRecipient[]
    excludedDuplicatePhoneCount: number
  }> {
    const recipients: PhoneListRecipient[] = []
    const rows = [CSV_HEADER_ROW]
    // Spans every page: two voters sharing a cell phone must dedupe even
    // when people-api splits them across pages (ENG-10801). Keeping the
    // first person per number is deterministic given people-api's stable
    // ordering, and it fixes the inbound sweep's phone->person mapping,
    // which is ambiguous when a phone maps to more than one capture row.
    const seenPhones = new Set<string>()
    let excludedDuplicatePhoneCount = 0

    let page = 1
    let hasNextPage = true
    while (hasNextPage) {
      // The people response is a cast, not a parse — a buggy hasNextPage
      // that never clears must not loop forever. One page past the cap is
      // the most a valid list can need.
      if (page > MAX_PHONE_LIST_PAGES) {
        throw new BadRequestException(
          `Pagination exceeded ${MAX_PHONE_LIST_PAGES} pages — aborting`,
        )
      }
      const { people, pagination } =
        await this.contactsService.findContactsForFilter(
          // SMS reachability belongs to the channel, not the shared filter
          // resolution — force it here regardless of what the request asked.
          { ...filterInput, hasCellPhone: true },
          { resultsPerPage: SEGMENT_PAGE_SIZE, page },
          organization,
          excludePersonIds,
        )

      for (const person of people) {
        // hasCellPhone: true is forced above; cellPhone is nullable on the
        // Person contract regardless, so skip a row people-api can't
        // guarantee a phone for rather than uploading an unusable CSV line.
        if (!person.cellPhone) continue
        // Peerly needs state, city, and zip for geo-targeting; null fields
        // produce blank CSV cells it counts as malformed leads. The people
        // response is a cast, not a parse, so address itself can be absent.
        if (
          !person.address ||
          !person.address.state ||
          !person.address.city ||
          !person.address.zip
        )
          continue
        if (seenPhones.has(person.cellPhone)) {
          excludedDuplicatePhoneCount += 1
          continue
        }
        seenPhones.add(person.cellPhone)
        recipients.push({ personId: person.id, phone: person.cellPhone })
        rows.push(
          [
            person.firstName,
            person.lastName,
            person.cellPhone,
            person.address.state,
            person.address.city,
            person.address.zip,
          ]
            .map(csvEscape)
            .join(','),
        )
      }

      // The cap counts uploadable rows, not the raw filter match — people
      // skipped above for a missing phone or address don't use up the
      // budget. Checked per page so an oversized filter stops paging as
      // soon as it exceeds the cap instead of resolving millions of rows.
      if (recipients.length > MAX_PHONE_LIST_RECIPIENTS) {
        throw new BadRequestException(
          `This filter matches over the ${MAX_PHONE_LIST_RECIPIENTS} ` +
            `phone-list limit — narrow the filter and try again.`,
        )
      }

      hasNextPage = pagination.hasNextPage
      page += 1
    }

    return {
      csvBuffer: Buffer.from(rows.join('\n') + '\n', 'utf-8'),
      recipients,
      excludedDuplicatePhoneCount,
    }
  }

  // ENG-10800: a person who opted out of a past text/p2p send in this org
  // must not land on the next phone list — the inbound sweep records the
  // opt-out but nothing consumed it at send time before this. The scrub is
  // best-effort against people-api's id-filter cap: an org with more
  // opt-outs than the cap must still be able to send, so a set that large
  // skips the scrub (logged loudly) rather than 400ing the send.
  private async resolveOptOutScrub(
    organizationSlug: string,
  ): Promise<Set<string>> {
    const optedOutIds =
      await this.contactInteractionTextService.findOptedOutPersonIds(
        organizationSlug,
      )
    if (optedOutIds.length === 0) return new Set()
    if (optedOutIds.length > MAX_RESOLVED_ID_SET_SIZE) {
      this.logger.warn(
        { organizationSlug, optedOutCount: optedOutIds.length },
        'Opt-out scrub set exceeds the people-api id-filter cap — skipping ' +
          'the scrub for this phone-list build rather than blocking the send',
      )
      return new Set()
    }
    return new Set(optedOutIds)
  }
}
