import { randomUUID } from 'node:crypto'
import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { Campaign } from '@/generated/prisma'
import {
  ContactsFilterResolutionInput,
  ContactsService,
} from '@/contacts/services/contacts.service'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { VoterFileFilterService } from '@/voters/services/voterFileFilter.service'
import { ROBOCALL_VENDOR, RobocallVendor } from '../vendor/robocallVendor'
import { LoadedAudience } from '../vendor/robocallVendor.types'

// Page the audience a slice at a time (mirrors materialization) and cap the
// total loaded in one send.
const SEGMENT_PAGE_SIZE = 1000
const MAX_PHONEBOOK_NUMBERS = 100_000

// The vendor fetches/ingests the CSV asynchronously, so the presigned GET must
// outlive that — an hour is generous.
const CSV_URL_EXPIRES_IN = 3600

// First link of the robocall send chain: resolve a saved voter list to its
// landline numbers and load them into a fresh vendor audience (no dialing, no
// voice-broadcast campaign — those are later slices). Invoked by the send step,
// not over HTTP. The vendor adapter owns the CSV-column mapping and the
// async-validation poll; this service only resolves the numbers, hosts the CSV,
// and hands the vendor a URL.
@Injectable()
export class RobocallPhonebookService {
  private readonly bucket: string

  constructor(
    private readonly contacts: ContactsService,
    private readonly organizations: OrganizationsService,
    private readonly voterFileFilterService: VoterFileFilterService,
    @Inject(ROBOCALL_VENDOR) private readonly vendor: RobocallVendor,
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
  ): Promise<LoadedAudience> {
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

    return this.vendor.loadAudience({
      name:
        `Robocall ${campaign.slug} filter ${voterFileFilterId} ` +
        new Date().toISOString(),
      csvUrl,
      countryIso: 'US',
    })
  }

  // Forces hasLandline and reads each person's landline (robocall reaches
  // landlines, not cells — ENG-10803), deduped and normalized to digits.
  private async resolveLandlineNumbers(
    campaign: Campaign,
    voterFileFilterId: number,
  ): Promise<string[]> {
    // TEST OVERRIDE (supervised live-test harness). When
    // ROBOCALL_TEST_OVERRIDE_NUMBER is set, the phonebook is loaded with ONLY
    // that one number and the real audience is never resolved. This is what lets
    // the full real-money flow (hold on the real estimate, dial, capture-actual,
    // refund) run end to end while guaranteeing no real voter is ever called —
    // this method is the single chokepoint for every number that reaches CallHub.
    // Fail CLOSED: a set-but-malformed value throws rather than falling through
    // to the real audience, since falling through would dial real people during
    // a "test". Unset = normal behavior below, untouched.
    const override = process.env.ROBOCALL_TEST_OVERRIDE_NUMBER
    if (override !== undefined && override !== '') {
      const digits = override.replace(/\D/g, '')
      const normalized =
        digits.length === 11 && digits.startsWith('1')
          ? digits.slice(1)
          : digits
      if (normalized.length !== 10) {
        throw new BadRequestException(
          'ROBOCALL_TEST_OVERRIDE_NUMBER is set but is not a valid 10-digit ' +
            'US number; refusing to load the real audience during a test',
        )
      }
      this.logger.warn(
        { filterId: voterFileFilterId, overrideNumber: normalized },
        'ROBOCALL TEST OVERRIDE active: loading ONLY the override number; the ' +
          'real audience is NOT resolved or dialed',
      )
      return [normalized]
    }

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
}
