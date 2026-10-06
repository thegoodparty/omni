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
import {
  MAX_INTERACTIVE_RESOLUTION_MS,
  PhoneAudiencePerson,
  resolveFilterAudience,
} from '@/contacts/utils/audienceResolution.util'
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

const CSV_HEADER_ROW = 'first_name,last_name,lead_phone,state,city,zip'

type PhoneListRecipient = { personId: string; phone: string }

// Peerly needs state, city, and zip for geo-targeting; null fields
// produce blank CSV cells it counts as malformed leads. The people
// response is a cast, not a parse, so address itself can be absent.
const hasGeoTargetableAddress = (person: PhoneAudiencePerson) =>
  Boolean(
    person.address &&
    person.address.state &&
    person.address.city &&
    person.address.zip,
  )

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
  ): Promise<{ token: string; listName: string; buildId: string }> {
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

    // Created BEFORE the build so a build-status poller has a row to find
    // from the moment the request is accepted (`queued`, the schema
    // default) — everything above this line is request validation (bad
    // input 400s before any row exists); everything below is "the build",
    // and any throw in it must park this same row `failed` rather than
    // leave it orphaned.
    const build = await this.peerlyPhoneListCapture.createQueuedBuild({
      organizationSlug: campaign.organizationSlug,
      campaignId: campaign.id,
      voterFileFilterId: filterInput.voterFileFilterId ?? null,
    })

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
      // The row's buildError mirrors whatever is ABOUT TO BE thrown to the
      // caller, never the raw caught `error` — that raw error can carry
      // vendor/internal detail (a people-api message, a stack-bearing
      // Error) this endpoint has never put in a client-facing response,
      // and a future poller reading buildError is still a client.
      if (error instanceof HttpException) {
        this.logger.warn(
          { error },
          `CSV generation rejected for campaign ${campaign.id} (HttpException passthrough)`,
        )
        await this.markBuildFailed(build.id, error)
        throw error
      }
      this.logger.error(
        { error },
        `Failed to generate voter data for phone list, campaign ${campaign.id}:`,
      )
      const buildError = new BadRequestException(
        'Failed to generate voter data for phone list',
      )
      await this.markBuildFailed(build.id, buildError)
      throw buildError
    }
    const { csvBuffer, recipients, excludedDuplicatePhoneCount } = phoneList
    if (recipients.length === 0) {
      const emptyAudienceError = new BadRequestException(
        'No contacts matched the filter with a valid phone number and ' +
          'complete address — narrow the filter or check your contact data.',
      )
      await this.markBuildFailed(build.id, emptyAudienceError)
      throw emptyAudienceError
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
      const buildError = new BadGatewayException(
        'Failed to upload phone list to Peerly platform',
      )
      await this.markBuildFailed(build.id, buildError)
      throw buildError
    }

    // Capture rows are only written once Peerly confirms it has the list —
    // both throws above happen before this line, so a list Peerly never
    // received can never gain recipient rows.
    //
    // The reported count is the candidate opt-out set size, not a
    // post-composition truth: if this org's support-status "unknown"
    // notIn resolution is itself large, ContactsService may drop the
    // opt-out merge to stay under people-api's id-filter cap
    // (excludePersonIdsFromResolution) — logged loudly there, but this
    // count won't reflect it. Rare (both sets have to be near-cap at
    // once) and acceptable for the observability this column exists for.
    await this.peerlyPhoneListCapture.recordUpload({
      buildId: build.id,
      token,
      recipients,
      excludedOptedOutCount: excludePersonIds.size,
      excludedDuplicatePhoneCount,
    })

    this.logger.debug(
      `P2P phone list uploaded successfully for campaign ${campaign.id}, token: ${token}, buildId: ${build.id}`,
    )

    return { token, listName, buildId: build.id }
  }

  // Best-effort: a DB write failing here must not mask the build/upload
  // error the caller is about to see (that's the one that matters), so this
  // only logs on failure. Callers pass the exact error being thrown to the
  // HTTP caller — never a raw internal one — so `buildError` never carries
  // more detail than the response a client already gets today; truncated
  // regardless, since it's a status field a poller reads, not a log sink.
  private async markBuildFailed(
    buildId: string,
    error: unknown,
  ): Promise<void> {
    const message = error instanceof Error ? error.message : String(error)
    await this.peerlyPhoneListCapture
      .markBuildFailed(buildId, message.slice(0, 500))
      .catch((markError: Error) =>
        this.logger.error(
          { markError, buildId },
          'Failed to mark phone list build as failed; row left in a prior build state',
        ),
      )
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

    const audience = resolveFilterAudience(this.contactsService, {
      filterInput,
      organization,
      excludePersonIds,
      pageSize: SEGMENT_PAGE_SIZE,
      maxRecipients: MAX_PHONE_LIST_RECIPIENTS,
      isEligible: hasGeoTargetableAddress,
      limitExceededMessage:
        `This filter matches over the ${MAX_PHONE_LIST_RECIPIENTS} ` +
        `phone-list limit — narrow the filter and try again.`,
      // An official is sat in front of this upload waiting for a token, so the
      // resolution gets a clock. The cap alone did not bound one: 100,000
      // recipients is 100 pages and the gateway hangs up at ~120s, so a filter
      // matching ~82,000 passed every guard, died with no response, and then
      // finished anyway — uploading a phone list to Peerly 45.9s after the
      // browser had already shown a failure (INC-101). Nothing deletes that
      // list, and the retry it invites makes a second one.
      timeBudgetMs: MAX_INTERACTIVE_RESOLUTION_MS,
      budgetExceededMessage: ({ matchedCount, affordableCount }) =>
        `This filter matches ${matchedCount} contacts — too many to build a ` +
        `phone list while you wait (about ${affordableCount} right now). ` +
        `Narrow the filter and try again.`,
    })

    let next = await audience.next()
    while (!next.done) {
      const person = next.value
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
      next = await audience.next()
    }

    return {
      csvBuffer: Buffer.from(rows.join('\n') + '\n', 'utf-8'),
      recipients,
      excludedDuplicatePhoneCount: next.value.excludedDuplicatePhoneCount,
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
