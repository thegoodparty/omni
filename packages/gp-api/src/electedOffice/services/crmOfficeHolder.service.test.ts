import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CrmOfficeHolderService,
  deriveOfficeHolderStatus,
} from './crmOfficeHolder.service'

const OBJECT_TYPE_ID = '2-66323754'
const CONTACT_ASSOCIATION_TYPE_ID = 68
const COMPANY_ASSOCIATION_TYPE_ID = 71

const APP_OWNED_KEYS = [
  'elected_date',
  'onboarding_completed_at',
  'pledged_at',
  'self_reported',
  'sworn_in_date',
]

const SEAT_KEYS = [
  'candidate_office',
  'name',
  'party_affiliation',
  'position_name',
  'state',
  'status',
  'term_end_date',
  'term_start_date',
]

const makeOffice = (overrides: Record<string, unknown> = {}) => ({
  id: 'eo-1',
  organizationSlug: 'eo-eo-1',
  swornInDate: new Date('2026-01-05T00:00:00.000Z'),
  electedDate: new Date('2025-11-04T00:00:00.000Z'),
  termStartDate: new Date('2026-01-05T00:00:00.000Z'),
  termEndDate: new Date('2030-01-05T00:00:00.000Z'),
  party: 'Independent',
  pledgedAt: new Date('2026-01-06T15:30:00.000Z'),
  onboardingCompletedAt: null,
  selfReported: true,
  onboardingStep: 'party',
  userId: 7,
  campaignId: 42,
  createdAt: new Date('2026-01-06T15:00:00.000Z'),
  updatedAt: new Date('2026-01-06T15:30:00.000Z'),
  user: {
    id: 7,
    email: 'jane@example.com',
    firstName: 'Jane',
    lastName: 'Doe',
    name: null,
    metaData: { hubspotId: 'contact-1' },
  },
  campaign: { id: 42, data: { hubspotId: 'company-1' } },
  ...overrides,
})

describe('CrmOfficeHolderService.syncElectedOffice', () => {
  const findUnique = vi.fn()
  const upsert = vi.fn()
  const associationsCreate = vi.fn()
  const getCrmCompanyOrgContextByOrgSlug = vi.fn()
  const errorMessage = vi.fn()
  const hubspot = {
    isConfigured: true,
    client: {
      crm: {
        objects: { batchApi: { upsert } },
        associations: { v4: { batchApi: { create: associationsCreate } } },
      },
    },
  }
  const logger = createMockLogger()

  let service: CrmOfficeHolderService

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-07T12:00:00.000Z'))
    vi.stubEnv('HUBSPOT_OFFICE_HOLDER_SYNC_ENABLED', 'true')
    vi.stubEnv('HUBSPOT_OFFICE_HOLDER_OBJECT_TYPE_ID', OBJECT_TYPE_ID)
    vi.stubEnv('HUBSPOT_OFFICE_HOLDER_CONTACT_ASSOCIATION_TYPE_ID', '68')
    vi.stubEnv('HUBSPOT_OFFICE_HOLDER_COMPANY_ASSOCIATION_TYPE_ID', '71')
    hubspot.isConfigured = true
    findUnique.mockResolvedValue(makeOffice())
    upsert.mockResolvedValue({ results: [{ id: 'oh-1', _new: true }] })
    associationsCreate.mockResolvedValue(undefined)
    getCrmCompanyOrgContextByOrgSlug.mockResolvedValue({
      district: {
        id: 'district-1',
        state: 'IL',
        l2Type: 'City',
        l2Name: 'Springfield',
      },
      ballotLevel: null,
      positionName: 'Springfield City Council',
      ballotReadyPositionId: null,
    })
    errorMessage.mockResolvedValue(undefined)

    service = new CrmOfficeHolderService(
      hubspot as never,
      { getCrmCompanyOrgContextByOrgSlug } as never,
      { errorMessage } as never,
    )
    // PrismaBase exposes `model` via a getter over the injected `_prisma`;
    // direct instantiation skips DI, so wire the delegate and logger by hand.
    Object.defineProperty(service, '_prisma', {
      value: { electedOffice: { findUnique } },
      writable: true,
    })
    Object.defineProperty(service, 'logger', {
      value: logger,
      writable: true,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  const sentProperties = (): Record<string, string> => {
    const [, body] = upsert.mock.calls[0] as [
      string,
      { inputs: [{ properties: Record<string, string> }] },
    ]
    return body.inputs[0].properties
  }

  it('does nothing while the kill flag is off', async () => {
    vi.stubEnv('HUBSPOT_OFFICE_HOLDER_SYNC_ENABLED', '')

    await service.syncElectedOffice('eo-1', { sendSeatFields: true })

    expect(findUnique).not.toHaveBeenCalled()
    expect(upsert).not.toHaveBeenCalled()
  })

  it.each([
    'HUBSPOT_OFFICE_HOLDER_OBJECT_TYPE_ID',
    'HUBSPOT_OFFICE_HOLDER_CONTACT_ASSOCIATION_TYPE_ID',
    'HUBSPOT_OFFICE_HOLDER_COMPANY_ASSOCIATION_TYPE_ID',
  ])('does nothing when %s is unset', async (name) => {
    vi.stubEnv(name, '')

    await expect(
      service.syncElectedOffice('eo-1', { sendSeatFields: true }),
    ).resolves.toBeUndefined()

    expect(findUnique).not.toHaveBeenCalled()
    expect(upsert).not.toHaveBeenCalled()
  })

  it('does nothing when HubSpot is not configured', async () => {
    hubspot.isConfigured = false

    await service.syncElectedOffice('eo-1', { sendSeatFields: true })

    expect(upsert).not.toHaveBeenCalled()
  })

  it('never sends a test user office to HubSpot', async () => {
    findUnique.mockResolvedValue(
      makeOffice({
        user: { ...makeOffice().user, email: 'e2e@test.goodparty.org' },
      }),
    )

    await service.syncElectedOffice('eo-1', { sendSeatFields: true })

    expect(upsert).not.toHaveBeenCalled()
    expect(associationsCreate).not.toHaveBeenCalled()
  })

  it('upserts the snapshot by the app id on a write that completes onboarding', async () => {
    findUnique.mockResolvedValue(
      makeOffice({
        onboardingCompletedAt: new Date('2026-01-06T15:31:00.000Z'),
      }),
    )

    await service.syncElectedOffice('eo-1', { sendSeatFields: true })

    expect(getCrmCompanyOrgContextByOrgSlug).toHaveBeenCalledWith('eo-eo-1')
    expect(upsert).toHaveBeenCalledWith(OBJECT_TYPE_ID, {
      inputs: [
        {
          idProperty: 'gp_api_elected_office_id',
          id: 'eo-1',
          properties: {
            name: 'Jane Doe, Springfield City Council (IL)',
            status: 'in_office',
            position_name: 'Springfield City Council',
            candidate_office: 'Springfield City Council',
            state: 'IL',
            party_affiliation: 'Independent',
            term_start_date: '2026-01-05',
            term_end_date: '2030-01-05',
            elected_date: '2025-11-04',
            sworn_in_date: '2026-01-05',
            pledged_at: '2026-01-06T15:30:00.000Z',
            onboarding_completed_at: '2026-01-06T15:31:00.000Z',
            self_reported: 'true',
          },
        },
      ],
    })
  })

  it('keeps sending the seat fields while serve onboarding is incomplete', async () => {
    await service.syncElectedOffice('eo-1')

    expect(Object.keys(sentProperties()).sort()).toEqual(
      [...APP_OWNED_KEYS, ...SEAT_KEYS].sort(),
    )
  })

  it('sends only the fields the app owns once onboarding is complete', async () => {
    findUnique.mockResolvedValue(
      makeOffice({
        onboardingCompletedAt: new Date('2026-01-06T15:31:00.000Z'),
      }),
    )

    await service.syncElectedOffice('eo-1')

    expect(Object.keys(sentProperties()).sort()).toEqual(APP_OWNED_KEYS)
    expect(getCrmCompanyOrgContextByOrgSlug).not.toHaveBeenCalled()
  })

  it('clears an app-owned field the office no longer has', async () => {
    findUnique.mockResolvedValue(
      makeOffice({
        swornInDate: null,
        selfReported: false,
        onboardingCompletedAt: new Date('2026-01-06T15:31:00.000Z'),
      }),
    )

    await service.syncElectedOffice('eo-1')

    expect(sentProperties()).toMatchObject({
      sworn_in_date: '',
      self_reported: 'false',
    })
  })

  it('omits the seat fields the app does not know yet', async () => {
    findUnique.mockResolvedValue(
      makeOffice({
        termStartDate: null,
        termEndDate: null,
        party: null,
        campaignId: null,
        campaign: null,
      }),
    )
    getCrmCompanyOrgContextByOrgSlug.mockResolvedValue({
      district: null,
      ballotLevel: null,
      positionName: null,
      ballotReadyPositionId: null,
    })

    await service.syncElectedOffice('eo-1', { sendSeatFields: true })

    const properties = sentProperties()
    expect(properties.name).toBe('Jane Doe')
    expect(Object.keys(properties).sort()).toEqual(
      [...APP_OWNED_KEYS, 'name'].sort(),
    )
  })

  it('links the record to the Contact as the office held', async () => {
    await service.syncElectedOffice('eo-1')

    expect(associationsCreate).toHaveBeenCalledWith(OBJECT_TYPE_ID, '0-1', {
      inputs: [
        {
          _from: { id: 'oh-1' },
          to: { id: 'contact-1' },
          types: [
            {
              associationCategory: 'USER_DEFINED',
              associationTypeId: CONTACT_ASSOCIATION_TYPE_ID,
            },
          ],
        },
      ],
    })
  })

  it('links the record to the Company of the campaign that won it', async () => {
    await service.syncElectedOffice('eo-1')

    expect(associationsCreate).toHaveBeenCalledWith(OBJECT_TYPE_ID, '0-2', {
      inputs: [
        {
          _from: { id: 'oh-1' },
          to: { id: 'company-1' },
          types: [
            {
              associationCategory: 'USER_DEFINED',
              associationTypeId: COMPANY_ASSOCIATION_TYPE_ID,
            },
          ],
        },
      ],
    })
  })

  it.each([
    ['has no campaign', { campaignId: null, campaign: null }],
    [
      'has a campaign without a Company',
      { campaign: { id: 42, data: { hubspotId: null } } },
    ],
  ])('skips only the Company link when the office %s', async (_, override) => {
    findUnique.mockResolvedValue(makeOffice(override))

    await service.syncElectedOffice('eo-1')

    expect(upsert).toHaveBeenCalledTimes(1)
    expect(associationsCreate).toHaveBeenCalledTimes(1)
    expect(associationsCreate).toHaveBeenCalledWith(
      OBJECT_TYPE_ID,
      '0-1',
      expect.anything(),
    )
  })

  it('skips only the Contact link when the user has no stored HubSpot id', async () => {
    findUnique.mockResolvedValue(
      makeOffice({ user: { ...makeOffice().user, metaData: {} } }),
    )

    await service.syncElectedOffice('eo-1')

    expect(upsert).toHaveBeenCalledTimes(1)
    expect(associationsCreate).toHaveBeenCalledTimes(1)
    expect(associationsCreate).toHaveBeenCalledWith(
      OBJECT_TYPE_ID,
      '0-2',
      expect.anything(),
    )
  })

  it('logs and alerts without throwing when HubSpot rejects the upsert', async () => {
    upsert.mockRejectedValue(new Error('HTTP 400 VALIDATION_ERROR'))

    await expect(service.syncElectedOffice('eo-1')).resolves.toBeUndefined()

    expect(logger.error).toHaveBeenCalled()
    expect(errorMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('eo-1'),
      }),
    )
    expect(associationsCreate).not.toHaveBeenCalled()
  })

  it('logs and alerts without throwing when a link fails', async () => {
    associationsCreate.mockRejectedValue(new Error('HTTP 502'))

    await expect(service.syncElectedOffice('eo-1')).resolves.toBeUndefined()

    expect(errorMessage).toHaveBeenCalled()
  })

  it('alerts when HubSpot reports a link error in a 207 response', async () => {
    associationsCreate.mockResolvedValue({
      status: 'COMPLETE',
      results: [],
      errors: [{ category: 'VALIDATION_ERROR', message: '0-1=9 is not valid' }],
    })

    await service.syncElectedOffice('eo-1')

    expect(errorMessage).toHaveBeenCalled()
  })

  it('alerts when HubSpot reports an upsert error in a 207 response', async () => {
    upsert.mockResolvedValue({
      status: 'COMPLETE',
      results: [],
      errors: [{ category: 'VALIDATION_ERROR', message: 'bad value' }],
    })

    await service.syncElectedOffice('eo-1')

    expect(errorMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({
          message: expect.stringContaining('bad value'),
        }),
      }),
    )
    expect(associationsCreate).not.toHaveBeenCalled()
  })

  it('still links the Company when the Contact link fails', async () => {
    associationsCreate.mockImplementation((_from: string, to: string) =>
      to === '0-1'
        ? Promise.reject(new Error('HTTP 502'))
        : Promise.resolve({ results: [] }),
    )

    await service.syncElectedOffice('eo-1')

    expect(associationsCreate).toHaveBeenCalledWith(
      OBJECT_TYPE_ID,
      '0-2',
      expect.anything(),
    )
    expect(errorMessage).toHaveBeenCalled()
  })
})

describe('deriveOfficeHolderStatus', () => {
  const now = new Date('2026-10-07T12:00:00.000Z')
  const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

  it.each([
    ['a term that has ended', d('2020-01-01'), d('2024-01-01'), 1, 'former'],
    ['a term ending today', d('2022-10-07'), d('2026-10-07'), 1, 'former'],
    ['a term under way', d('2026-01-05'), d('2030-01-05'), null, 'in_office'],
    [
      'a term not yet started',
      d('2027-01-05'),
      d('2031-01-05'),
      null,
      'elected',
    ],
    ['no term dates but a won campaign', null, null, 1, 'elected'],
    ['no term dates and no campaign', null, null, null, undefined],
  ])('is right for %s', (_, termStartDate, termEndDate, campaignId, status) => {
    expect(
      deriveOfficeHolderStatus({ termStartDate, termEndDate, campaignId }, now),
    ).toBe(status)
  })
})
