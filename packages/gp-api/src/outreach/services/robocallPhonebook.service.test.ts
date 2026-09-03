import { BadGatewayException, BadRequestException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { ContactsService } from '@/contacts/services/contacts.service'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { VoterFileFilterService } from '@/voters/services/voterFileFilter.service'
import { Campaign } from '@/generated/prisma'
import { RobocallVendor } from '../vendor/robocallVendor'
import { RobocallPhonebookService } from './robocallPhonebook.service'

const campaign = { id: 7, slug: 'jane-for-mayor', organizationSlug: 'org-1' }

const peoplePage = (landlines: (string | null)[], hasNextPage = false) => ({
  people: landlines.map((landline, i) => ({ id: `p_${i}`, landline })),
  pagination: { hasNextPage },
})

describe('RobocallPhonebookService', () => {
  let contacts: { findContactsForFilter: ReturnType<typeof vi.fn> }
  let organizations: { findFirst: ReturnType<typeof vi.fn> }
  let voterFileFilterService: {
    findByIdAndOrganizationSlug: ReturnType<typeof vi.fn>
  }
  let vendor: { loadAudience: ReturnType<typeof vi.fn> }
  let s3: {
    uploadFile: ReturnType<typeof vi.fn>
    getSignedUrlForViewing: ReturnType<typeof vi.fn>
  }
  let service: RobocallPhonebookService

  beforeEach(() => {
    process.env.ROBOCALL_AUDIO_BUCKET = 'robocall-audio-test'
    delete process.env.ROBOCALL_TEST_OVERRIDE_NUMBER
    contacts = { findContactsForFilter: vi.fn() }
    organizations = { findFirst: vi.fn().mockResolvedValue({ id: 1 }) }
    voterFileFilterService = {
      findByIdAndOrganizationSlug: vi
        .fn()
        .mockResolvedValue({ id: 99, organizationSlug: 'org-1' }),
    }
    vendor = {
      loadAudience: vi
        .fn()
        .mockResolvedValue({ audienceRef: 'list_1', loadedCount: 3 }),
    }
    s3 = {
      uploadFile: vi.fn().mockResolvedValue('ignored'),
      getSignedUrlForViewing: vi
        .fn()
        .mockResolvedValue('https://s3.example/audience.csv?sig=abc'),
    }

    service = new RobocallPhonebookService(
      contacts as unknown as ContactsService,
      organizations as unknown as OrganizationsService,
      voterFileFilterService as unknown as VoterFileFilterService,
      vendor as unknown as RobocallVendor,
      s3 as unknown as S3Service,
      createMockLogger(),
    )
  })

  const run = () => service.loadAudienceToPhonebook(campaign as Campaign, 99)

  it('resolves the deduped, normalized landlines and hands the vendor the CSV', async () => {
    contacts.findContactsForFilter.mockResolvedValue(
      peoplePage([
        '(202) 555-0100', // 10 digits
        '202-555-0101', // 10 digits
        '1-202-555-0102', // 11 digits, leading US 1 -> normalized to 10
        '(202) 555-0100', // duplicate of the first
        '555-1234', // 7 digits, malformed -> dropped
        null,
      ]),
    )

    const result = await run()

    // Filter is forced to landline.
    expect(contacts.findContactsForFilter).toHaveBeenCalledWith(
      expect.objectContaining({ id: 99, hasLandline: true }),
      { resultsPerPage: 1000, page: 1 },
      { id: 1 },
    )

    // CSV holds the extracted numbers behind a header row, deduped,
    // digits-only, leading-1 stripped, malformed rows dropped.
    expect(s3.uploadFile).toHaveBeenCalledWith(
      'robocall-audio-test',
      'phone\n2025550100\n2025550101\n2025550102\n',
      expect.stringMatching(/^robocall-phonebook\/7\//),
      { contentType: 'text/csv' },
    )

    // The neutral audience load is fired with the presigned URL; the adapter
    // owns the CSV-column mapping and the async-validation poll.
    expect(vendor.loadAudience).toHaveBeenCalledWith({
      name: expect.stringContaining('Robocall jane-for-mayor filter 99'),
      csvUrl: 'https://s3.example/audience.csv?sig=abc',
      countryIso: 'US',
    })

    // The neutral audience handle is returned verbatim.
    expect(result).toEqual({ audienceRef: 'list_1', loadedCount: 3 })
  })

  it('pages until hasNextPage is false', async () => {
    contacts.findContactsForFilter
      .mockResolvedValueOnce(peoplePage(['2025550001'], true))
      .mockResolvedValueOnce(peoplePage(['2025550002'], false))

    await run()

    expect(contacts.findContactsForFilter).toHaveBeenCalledTimes(2)
    expect(s3.uploadFile).toHaveBeenCalledWith(
      'robocall-audio-test',
      'phone\n2025550001\n2025550002\n',
      expect.any(String),
      { contentType: 'text/csv' },
    )
  })

  it('rejects when the list resolves to no landlines', async () => {
    contacts.findContactsForFilter.mockResolvedValue(peoplePage([null, '']))

    await expect(run()).rejects.toBeInstanceOf(BadRequestException)
    expect(vendor.loadAudience).not.toHaveBeenCalled()
  })

  it('rejects a missing organization', async () => {
    organizations.findFirst.mockResolvedValue(null)

    await expect(run()).rejects.toBeInstanceOf(BadRequestException)
  })

  it('rejects a missing voter list', async () => {
    voterFileFilterService.findByIdAndOrganizationSlug.mockResolvedValue(null)

    await expect(run()).rejects.toBeInstanceOf(BadRequestException)
  })

  it('propagates a vendor load failure as a 502', async () => {
    contacts.findContactsForFilter.mockResolvedValue(peoplePage(['2025550001']))
    vendor.loadAudience.mockRejectedValue(
      new BadGatewayException('vendor down'),
    )

    await expect(run()).rejects.toBeInstanceOf(BadGatewayException)
  })

  describe('ROBOCALL_TEST_OVERRIDE_NUMBER (live-test harness)', () => {
    it('loads ONLY the override number and never resolves the real audience', async () => {
      process.env.ROBOCALL_TEST_OVERRIDE_NUMBER = '804-222-1111'

      const result = await run()

      // The real audience is never touched: no voter is resolved or dialed.
      expect(contacts.findContactsForFilter).not.toHaveBeenCalled()
      // Exactly the normalized override number is loaded into the audience.
      expect(s3.uploadFile).toHaveBeenCalledWith(
        'robocall-audio-test',
        'phone\n8042221111\n',
        expect.any(String),
        { contentType: 'text/csv' },
      )
      expect(result).toEqual({ audienceRef: 'list_1', loadedCount: 3 })
    })

    it('normalizes a leading US country code and formatting', async () => {
      process.env.ROBOCALL_TEST_OVERRIDE_NUMBER = '+1 (804) 222-1111'

      await run()

      expect(s3.uploadFile).toHaveBeenCalledWith(
        'robocall-audio-test',
        'phone\n8042221111\n',
        expect.any(String),
        { contentType: 'text/csv' },
      )
    })

    it('fails closed on a malformed override, never touching the real audience', async () => {
      process.env.ROBOCALL_TEST_OVERRIDE_NUMBER = '555-1234' // 7 digits

      await expect(run()).rejects.toBeInstanceOf(BadRequestException)
      expect(contacts.findContactsForFilter).not.toHaveBeenCalled()
      expect(vendor.loadAudience).not.toHaveBeenCalled()
    })
  })
})
