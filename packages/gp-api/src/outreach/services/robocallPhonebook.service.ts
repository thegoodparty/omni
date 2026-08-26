import { randomUUID } from 'node:crypto'
import {
  BadGatewayException,
  BadRequestException,
  Injectable,
} from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { Campaign } from '@/generated/prisma'
import {
  ContactsFilterResolutionInput,
  ContactsService,
} from '@/contacts/services/contacts.service'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { CallhubBulkImportService } from '@/vendors/callhub/services/callhubBulkImport.service'
import { CallhubPhonebookService } from '@/vendors/callhub/services/callhubPhonebook.service'
import { CALLHUB_CONTACT_FIELD } from '@/vendors/callhub/schemas/callhubBulkImport.schema'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { sleep } from '@/shared/util/sleep.util'
import { VoterFileFilterService } from '@/voters/services/voterFileFilter.service'

// Page the audience a slice at a time (mirrors materialization) and cap the
// total loaded in one send.
const SEGMENT_PAGE_SIZE = 1000
const MAX_PHONEBOOK_NUMBERS = 100_000

// CallHub fetches the CSV asynchronously and bulk import is rate-limited to
// 1/min, so the presigned GET must outlive both — an hour is generous.
const CSV_URL_EXPIRES_IN = 3600

// The import is asynchronous with no job id; poll the phonebook count until it
// reflects the load. Bounded so a stuck import fails loudly instead of hanging
// the send step forever. A tiny list loads in seconds; the ceiling covers a
// six-figure one.
const IMPORT_POLL_ATTEMPTS = 30
const IMPORT_POLL_DELAY_MS = 4000

export interface RobocallPhonebookLoadResult {
  phonebookPkStr: string
  importedCount: number
}

// First link of the robocall send chain: resolve a saved voter list to its
// landline numbers and load them into a fresh CallHub phonebook (no dialing,
// no voice-broadcast campaign — those are later slices). Invoked by the send
// step, not over HTTP.
@Injectable()
export class RobocallPhonebookService {
  private readonly bucket: string

  constructor(
    private readonly contacts: ContactsService,
    private readonly organizations: OrganizationsService,
    private readonly voterFileFilterService: VoterFileFilterService,
    private readonly phonebooks: CallhubPhonebookService,
    private readonly bulkImport: CallhubBulkImportService,
    private readonly s3: S3Service,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(RobocallPhonebookService.name)
    const bucket = process.env.ROBOCALL_AUDIO_BUCKET
    if (!bucket) {
      throw new Error('ROBOCALL_AUDIO_BUCKET is not configured')
    }
    this.bucket = bucket
  }

  async loadAudienceToPhonebook(
    campaign: Campaign,
    voterFileFilterId: number,
  ): Promise<RobocallPhonebookLoadResult> {
    const numbers = await this.resolveLandlineNumbers(
      campaign,
      voterFileFilterId,
    )
    if (numbers.length === 0) {
      throw new BadRequestException(
        'Voter list resolved to no landline numbers to load',
      )
    }

    const csvUrl = await this.uploadCsv(campaign.id, numbers)

    const phonebook = await this.phonebooks.createPhonebook({
      name:
        `Robocall ${campaign.slug} filter ${voterFileFilterId} ` +
        new Date().toISOString(),
    })

    await this.bulkImport.importContacts({
      phonebookPkStr: phonebook.pk_str,
      csvUrl,
      mapping: { [CALLHUB_CONTACT_FIELD.CONTACT]: 0 },
      countryIso: 'US',
    })

    const importedCount = await this.pollImportedCount(
      phonebook.pk_str,
      numbers.length,
    )

    return { phonebookPkStr: phonebook.pk_str, importedCount }
  }

  // Forces hasLandline and reads each person's landline (robocall reaches
  // landlines, not cells — ENG-10803), deduped and normalized to digits.
  private async resolveLandlineNumbers(
    campaign: Campaign,
    voterFileFilterId: number,
  ): Promise<string[]> {
    const organization = await this.organizations.findFirst({
      where: { slug: campaign.organizationSlug },
    })
    if (!organization) {
      throw new BadRequestException(
        `Organization ${campaign.organizationSlug} not found`,
      )
    }

    const filter =
      await this.voterFileFilterService.findByIdAndOrganizationSlug(
        voterFileFilterId,
        campaign.organizationSlug,
      )
    if (!filter) {
      throw new BadRequestException(
        `Voter list ${voterFileFilterId} not found for ` +
          campaign.organizationSlug,
      )
    }
    const landlineFilter: ContactsFilterResolutionInput = {
      ...filter,
      hasLandline: true,
    }

    const seen = new Set<string>()
    let page = 1
    while (seen.size < MAX_PHONEBOOK_NUMBERS) {
      const { people, pagination } = await this.contacts.findContactsForFilter(
        landlineFilter,
        { resultsPerPage: SEGMENT_PAGE_SIZE, page },
        organization,
      )
      if (people.length === 0) break

      for (const person of people) {
        // hasLandline only guarantees non-null, not a dialable format. Drop a
        // leading US country code and keep only genuine 10-digit numbers, so
        // `expected` counts what CallHub can actually load — CallHub silently
        // drops malformed rows, which would otherwise look like a stalled
        // import when the poll never reaches the total.
        const digits = person.landline?.replace(/\D/g, '') ?? ''
        const normalized =
          digits.length === 11 && digits.startsWith('1')
            ? digits.slice(1)
            : digits
        if (normalized.length === 10) seen.add(normalized)
        if (seen.size >= MAX_PHONEBOOK_NUMBERS) break
      }

      if (!pagination.hasNextPage || seen.size >= MAX_PHONEBOOK_NUMBERS) {
        if (pagination.hasNextPage) {
          this.logger.warn(
            { filterId: voterFileFilterId, loaded: seen.size },
            'Robocall phonebook load hit the per-send cap; remaining ' +
              'landline numbers were not loaded',
          )
        }
        break
      }
      page += 1
    }

    return [...seen]
  }

  // Phone in column 0 (CALLHUB_CONTACT_FIELD.CONTACT). CallHub treats the
  // first CSV row as a header and skips it, so lead with one.
  private async uploadCsv(
    campaignId: number,
    numbers: string[],
  ): Promise<string> {
    const csv = ['phone', ...numbers].join('\n') + '\n'
    const key = `robocall-phonebook/${campaignId}/${randomUUID()}.csv`

    await this.s3.uploadFile(this.bucket, csv, key, {
      contentType: 'text/csv',
    })

    return this.s3.getSignedUrlForViewing(this.bucket, key, {
      expiresIn: CSV_URL_EXPIRES_IN,
    })
  }

  private async pollImportedCount(
    phonebookPkStr: string,
    expected: number,
  ): Promise<number> {
    let count = 0
    for (let attempt = 0; attempt < IMPORT_POLL_ATTEMPTS; attempt++) {
      await sleep(IMPORT_POLL_DELAY_MS)
      try {
        count = await this.phonebooks.getContactCount(phonebookPkStr)
      } catch (err) {
        // Only a mapped vendor error (throttle/5xx → BadGatewayException) is
        // transient and worth retrying while the async import settles; any
        // other error (e.g. a schema-parse failure) is permanent and must
        // propagate immediately rather than burn the whole poll window.
        if (!(err instanceof BadGatewayException)) throw err
        this.logger.warn(
          { phonebookPkStr, attempt, err },
          'Transient error polling phonebook contact count; retrying',
        )
        continue
      }
      if (count >= expected) return count
    }

    // The numbers are deduped and normalized to well-formed US digits before
    // upload, so CallHub should accept every one — a count still short of the
    // audience after the whole window means the import stalled, not that rows
    // were legitimately rejected. Fail loudly (like the empty-list path)
    // rather than hand a later send step a stuck or partial phonebook.
    throw new BadGatewayException(
      `CallHub phonebook import loaded ${count}/${expected} numbers within ` +
        'the poll window',
    )
  }
}
