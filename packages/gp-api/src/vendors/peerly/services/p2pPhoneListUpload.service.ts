import { BadRequestException, HttpException, Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { Campaign, Organization } from '../../../generated/prisma'
import { CampaignTcrComplianceService } from '../../../campaigns/tcrCompliance/services/campaignTcrCompliance.service'
import { ContactsService } from '@/contacts/services/contacts.service'
import { csvEscape } from '@/shared/util/csv.util'
import { OrganizationsService } from '../../../organizations/services/organizations.service'
import { P2pPhoneListRequestSchema } from '../schemas/p2pPhoneListRequest.schema'
import { PeerlyPhoneListCaptureService } from './peerlyPhoneListCapture.service'
import { PeerlyPhoneListService } from './peerlyPhoneList.service'

// Mirrors outreachMaterialization.service.ts's paging shape. Not shared as an
// export — each contacts-pipeline consumer keeps its own copy (see that
// file's SEGMENT_PAGE_SIZE for the sibling constant).
const SEGMENT_PAGE_SIZE = 1000
const MAX_PHONE_LIST_RECIPIENTS = 100_000

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

    let phoneList: { csvBuffer: Buffer; recipients: PhoneListRecipient[] }
    try {
      phoneList = await this.buildPhoneList(filterInput, organization)
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
    const { csvBuffer, recipients } = phoneList

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
      throw new BadRequestException(
        'Failed to upload phone list to Peerly platform',
      )
    }

    // Capture rows are only written once Peerly confirms it has the list —
    // both throws above happen before this line, so a list Peerly never
    // received can never gain capture rows.
    await this.peerlyPhoneListCapture.recordUpload({
      organizationSlug: campaign.organizationSlug,
      campaignId: campaign.id,
      token,
      voterFileFilterId: filterInput.voterFileFilterId ?? null,
      recipients,
    })

    this.logger.debug(
      `P2P phone list uploaded successfully for campaign ${campaign.id}, token: ${token}`,
    )

    return { token, listName }
  }

  private async buildPhoneList(
    filterInput: Omit<P2pPhoneListRequestSchema, 'name'>,
    organization: Organization,
  ): Promise<{ csvBuffer: Buffer; recipients: PhoneListRecipient[] }> {
    const recipients: PhoneListRecipient[] = []
    const rows = [CSV_HEADER_ROW]

    let page = 1
    let hasNextPage = true
    while (hasNextPage) {
      const { people, pagination } =
        await this.contactsService.findContactsForFilter(
          // SMS reachability belongs to the channel, not the shared filter
          // resolution — force it here regardless of what the request asked.
          { ...filterInput, hasCellPhone: true },
          { resultsPerPage: SEGMENT_PAGE_SIZE, page },
          organization,
        )

      if (pagination.totalResults > MAX_PHONE_LIST_RECIPIENTS) {
        throw new BadRequestException(
          `This filter matches ${pagination.totalResults} people with a ` +
            `cell phone, over the ${MAX_PHONE_LIST_RECIPIENTS} phone-list ` +
            `limit — narrow the filter and try again.`,
        )
      }

      for (const person of people) {
        // hasCellPhone: true is forced above; cellPhone is nullable on the
        // Person contract regardless, so skip a row people-api can't
        // guarantee a phone for rather than uploading an unusable CSV line.
        if (!person.cellPhone) continue
        // Peerly needs state, city, and zip for geo-targeting; null fields
        // produce blank CSV cells it counts as malformed leads.
        if (
          !person.address.state ||
          !person.address.city ||
          !person.address.zip
        )
          continue
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

      hasNextPage = pagination.hasNextPage
      page += 1
    }

    return {
      csvBuffer: Buffer.from(rows.join('\n') + '\n', 'utf-8'),
      recipients,
    }
  }
}
