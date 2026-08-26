import { BadGatewayException, BadRequestException } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { ContactsService } from '@/contacts/services/contacts.service'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { CallhubBulkImportService } from '@/vendors/callhub/services/callhubBulkImport.service'
import { CallhubPhonebookService } from '@/vendors/callhub/services/callhubPhonebook.service'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { VoterFileFilterService } from '@/voters/services/voterFileFilter.service'
import { Campaign } from '@/generated/prisma'
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
  let phonebooks: {
    createPhonebook: ReturnType<typeof vi.fn>
    getContactCount: ReturnType<typeof vi.fn>
  }
  let bulkImport: { importContacts: ReturnType<typeof vi.fn> }
  let s3: {
    uploadFile: ReturnType<typeof vi.fn>
    getSignedUrlForViewing: ReturnType<typeof vi.fn>
  }
  let service: RobocallPhonebookService

  beforeEach(() => {
    process.env.ROBOCALL_AUDIO_BUCKET = 'robocall-audio-test'
    contacts = { findContactsForFilter: vi.fn() }
    organizations = { findFirst: vi.fn().mockResolvedValue({ id: 1 }) }
    voterFileFilterService = {
      findByIdAndOrganizationSlug: vi
        .fn()
        .mockResolvedValue({ id: 99, organizationSlug: 'org-1' }),
    }
    phonebooks = {
      createPhonebook: vi.fn().mockResolvedValue({ pk_str: 'pb-1' }),
      getContactCount: vi.fn(),
    }
    bulkImport = { importContacts: vi.fn().mockResolvedValue({}) }
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
      phonebooks as unknown as CallhubPhonebookService,
      bulkImport as unknown as CallhubBulkImportService,
      s3 as unknown as S3Service,
      createMockLogger(),
    )
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const run = async () => {
    vi.useFakeTimers()
    const promise = service.loadAudienceToPhonebook(campaign as Campaign, 99)
    await vi.runAllTimersAsync()
    return promise
  }

  it('loads the deduped, digits-only landlines into a fresh phonebook', async () => {
    contacts.findContactsForFilter.mockResolvedValue(
      peoplePage(['(202) 555-0100', '202-555-0101', '(202) 555-0100', null]),
    )
    phonebooks.getContactCount.mockResolvedValue(2)

    const result = await run()

    // Filter is forced to landline.
    expect(contacts.findContactsForFilter).toHaveBeenCalledWith(
      expect.objectContaining({ id: 99, hasLandline: true }),
      { resultsPerPage: 1000, page: 1 },
      { id: 1 },
    )

    // CSV holds the extracted numbers behind a header row, deduped, digits-only.
    expect(s3.uploadFile).toHaveBeenCalledWith(
      'robocall-audio-test',
      'phone\n2025550100\n2025550101\n',
      expect.stringMatching(/^robocall-phonebook\/7\//),
      { contentType: 'text/csv' },
    )

    // Phonebook created, then bulk import fired with the presigned URL + the
    // calling-number mapping.
    expect(phonebooks.createPhonebook).toHaveBeenCalledOnce()
    expect(bulkImport.importContacts).toHaveBeenCalledWith({
      phonebookPkStr: 'pb-1',
      csvUrl: 'https://s3.example/audience.csv?sig=abc',
      mapping: { 0: 0 },
      countryIso: 'US',
    })

    expect(result).toEqual({ phonebookPkStr: 'pb-1', importedCount: 2 })
  })

  it('pages until hasNextPage is false', async () => {
    contacts.findContactsForFilter
      .mockResolvedValueOnce(peoplePage(['2025550001'], true))
      .mockResolvedValueOnce(peoplePage(['2025550002'], false))
    phonebooks.getContactCount.mockResolvedValue(2)

    const result = await run()

    expect(contacts.findContactsForFilter).toHaveBeenCalledTimes(2)
    expect(s3.uploadFile).toHaveBeenCalledWith(
      'robocall-audio-test',
      'phone\n2025550001\n2025550002\n',
      expect.any(String),
      { contentType: 'text/csv' },
    )
    expect(result.importedCount).toBe(2)
  })

  it('polls the count until it reaches the expected total', async () => {
    contacts.findContactsForFilter.mockResolvedValue(
      peoplePage(['2025550001', '2025550002']),
    )
    phonebooks.getContactCount
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2)

    const result = await run()

    expect(phonebooks.getContactCount).toHaveBeenCalledTimes(3)
    expect(result.importedCount).toBe(2)
  })

  it('tolerates a transient poll error and keeps polling', async () => {
    contacts.findContactsForFilter.mockResolvedValue(peoplePage(['2025550001']))
    phonebooks.getContactCount
      .mockRejectedValueOnce(new BadGatewayException('throttled'))
      .mockResolvedValue(1)

    const result = await run()

    expect(phonebooks.getContactCount).toHaveBeenCalledTimes(2)
    expect(result.importedCount).toBe(1)
  })

  it('propagates a non-transient poll error immediately', async () => {
    contacts.findContactsForFilter.mockResolvedValue(peoplePage(['2025550001']))
    phonebooks.getContactCount.mockRejectedValue(new BadRequestException('bad'))

    vi.useFakeTimers()
    const promise = service.loadAudienceToPhonebook(campaign as Campaign, 99)
    const assertion =
      expect(promise).rejects.toBeInstanceOf(BadRequestException)
    await vi.runAllTimersAsync()
    await assertion
    expect(phonebooks.getContactCount).toHaveBeenCalledTimes(1)
  })

  it('throws when the import never reaches the expected count', async () => {
    contacts.findContactsForFilter.mockResolvedValue(
      peoplePage(['2025550001', '2025550002']),
    )
    phonebooks.getContactCount.mockResolvedValue(1)

    vi.useFakeTimers()
    const promise = service.loadAudienceToPhonebook(campaign as Campaign, 99)
    const assertion =
      expect(promise).rejects.toBeInstanceOf(BadGatewayException)
    await vi.runAllTimersAsync()
    await assertion
  })

  it('rejects when the list resolves to no landlines', async () => {
    contacts.findContactsForFilter.mockResolvedValue(peoplePage([null, '']))

    await expect(
      service.loadAudienceToPhonebook(campaign as Campaign, 99),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(phonebooks.createPhonebook).not.toHaveBeenCalled()
  })

  it('rejects a missing voter list', async () => {
    voterFileFilterService.findByIdAndOrganizationSlug.mockResolvedValue(null)

    await expect(
      service.loadAudienceToPhonebook(campaign as Campaign, 99),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('propagates a CallHub failure as a 502', async () => {
    contacts.findContactsForFilter.mockResolvedValue(peoplePage(['2025550001']))
    phonebooks.createPhonebook.mockRejectedValue(
      new BadGatewayException('CallHub down'),
    )

    await expect(
      service.loadAudienceToPhonebook(campaign as Campaign, 99),
    ).rejects.toBeInstanceOf(BadGatewayException)
  })
})
