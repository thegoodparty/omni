import { BadRequestException, HttpStatus } from '@nestjs/common'
import {
  AxiosError,
  AxiosHeaders,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios'
import { addDays, format } from 'date-fns'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FeaturesService } from '@/features/services/features.service'
import { useTestService } from '@/test-service'
import { PeerlyHttpService } from '@/vendors/peerly/services/peerlyHttp.service'
import { PeerlyP2pJobService } from '@/vendors/peerly/services/peerlyP2pJob.service'
import { PeerlyPhoneListService } from '@/vendors/peerly/services/peerlyPhoneList.service'
import { PeerlyTestListService } from '@/vendors/peerly/services/peerlyTestList.service'
import { PhoneListState } from '@/vendors/peerly/peerly.types'
import { OutreachStatus, OutreachType } from '../../generated/prisma'

const service = useTestService()

const SEND_DATE = addDays(new Date(), 7)

const createTestJob = vi.fn()
const sendTestMessage = vi.fn()
const resolveTestListId = vi.fn()

let campaignId: number
let flagEnabled: ReturnType<typeof vi.spyOn>

beforeEach(async () => {
  createTestJob.mockReset().mockResolvedValue('test-job-1')
  sendTestMessage.mockReset().mockResolvedValue(undefined)
  resolveTestListId.mockReset().mockResolvedValue(169614)

  vi.spyOn(
    service.app.get(PeerlyP2pJobService),
    'createTestJob',
  ).mockImplementation(createTestJob)
  vi.spyOn(
    service.app.get(PeerlyP2pJobService),
    'sendTestMessage',
  ).mockImplementation(sendTestMessage)
  vi.spyOn(
    service.app.get(PeerlyTestListService),
    'resolveTestListId',
  ).mockImplementation(resolveTestListId)

  flagEnabled = vi
    .spyOn(service.app.get(FeaturesService), 'isFeatureEnabled')
    .mockResolvedValue(true)

  campaignId = 995
  const orgSlug = `campaign-${campaignId}`
  await service.prisma.organization.create({
    data: { slug: orgSlug, ownerId: service.user.id, positionId: 'pos-1' },
  })
  await service.prisma.campaign.create({
    data: {
      id: campaignId,
      organizationSlug: orgSlug,
      userId: service.user.id,
      slug: 'jane-doe-candidate-test',
      details: { state: 'TX', zip: '78634' },
      data: {},
    },
  })
})

const seedOutreach = (
  overrides: Partial<{
    campaignId: number
    status: OutreachStatus
    projectId: string | null
    identityId: string | null
  }> = {},
) =>
  service.prisma.outreach.create({
    data: {
      campaignId,
      outreachType: OutreachType.p2p,
      name: 'Likely voters — SMS',
      status: OutreachStatus.pending,
      projectId: 'peerly-job-1',
      identityId: 'identity-1',
      script: 'Hello {first_name}, this is Jane. Reply STOP to opt out.',
      date: SEND_DATE,
      scheduledLocalDate: format(SEND_DATE, 'yyyy-MM-dd'),
      textCount: 1200,
      billableTextCount: 1200,
      ...overrides,
    },
  })

const post = (id: number, phones: string[]) =>
  service.client.post(
    `/v1/outreach/${id}/sms/test`,
    { phones },
    { headers: { 'x-organization-slug': `campaign-${campaignId}` } },
  )

const peerlyError = (status: number, message: string) => {
  const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig
  return new AxiosError('Request failed', 'ERR_BAD_REQUEST', config, null, {
    data: { Error: message },
    status,
    statusText: '',
    headers: {},
    config,
  })
}

describe('POST /v1/outreach/:id/sms/test', () => {
  it('sends to each number on one fresh test job', async () => {
    const row = await seedOutreach()

    const res = await post(row.id, ['+15551234567', '5559876543'])

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data).toEqual({
      results: [
        { phone: '5551234567', result: 'sent', message: null },
        { phone: '5559876543', result: 'sent', message: null },
      ],
    })
    expect(createTestJob).toHaveBeenCalledTimes(1)
    expect(createTestJob).toHaveBeenCalledWith('peerly-job-1')
    expect(sendTestMessage).toHaveBeenCalledTimes(2)
    expect(sendTestMessage).toHaveBeenCalledWith(
      'test-job-1',
      '5551234567',
      169614,
    )
    expect(sendTestMessage).toHaveBeenCalledWith(
      'test-job-1',
      '5559876543',
      169614,
    )
  })

  it('sends a number typed two ways once', async () => {
    const row = await seedOutreach()

    const res = await post(row.id, ['+15551234567', '5551234567'])

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.results).toHaveLength(1)
    expect(sendTestMessage).toHaveBeenCalledTimes(1)
  })

  it('reports not_cell for a number Peerly refuses and still texts the other', async () => {
    const row = await seedOutreach()
    vi.mocked(
      service.app.get(PeerlyTestListService).resolveTestListId,
    ).mockRestore()
    vi.spyOn(
      service.app.get(PeerlyPhoneListService),
      'listPhoneLists',
    ).mockResolvedValue([
      {
        list_id: 169614,
        list_name: 'GoodParty test list identity-1',
        list_state: PhoneListState.ACTIVE,
        suppress_cell_phones: 6,
      },
    ])
    vi.spyOn(service.app.get(PeerlyHttpService), 'post').mockImplementation(
      async (path: string, body?: unknown) => {
        if (
          path.endsWith('/addcontact') &&
          JSON.stringify(body).includes('5551234567')
        ) {
          throw peerlyError(403, 'Not a cell number')
        }
        return { data: {} } as AxiosResponse
      },
    )

    const res = await post(row.id, ['5551234567', '5559876543'])

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.results).toEqual([
      {
        phone: '5551234567',
        result: 'not_cell',
        message: expect.stringContaining('only text cell numbers'),
      },
      { phone: '5559876543', result: 'sent', message: null },
    ])
    expect(createTestJob).toHaveBeenCalledTimes(1)
    expect(sendTestMessage).toHaveBeenCalledTimes(1)
  })

  it('creates no test job when every number is refused, and allows a retry', async () => {
    const row = await seedOutreach()
    resolveTestListId.mockRejectedValueOnce(new BadRequestException('nope'))

    const first = await post(row.id, ['5551234567'])
    expect(first.data.results[0].result).toBe('failed')
    expect(createTestJob).not.toHaveBeenCalled()

    const retried = await post(row.id, ['5551234567'])
    expect(retried.status).toBe(HttpStatus.CREATED)
    expect(retried.data.results[0].result).toBe('sent')
  })

  it('400s six numbers', async () => {
    const row = await seedOutreach()

    const res = await post(row.id, [
      '5551230001',
      '5551230002',
      '5551230003',
      '5551230004',
      '5551230005',
      '5551230006',
    ])

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(createTestJob).not.toHaveBeenCalled()
  })

  it('400s a non-US number before any vendor call', async () => {
    const row = await seedOutreach()

    const res = await post(row.id, ['+445551234567'])

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(createTestJob).not.toHaveBeenCalled()
  })

  it('404s another campaign’s outreach', async () => {
    const other = await service.prisma.user.create({
      data: { email: 'other-candidate@example.com' },
    })
    await service.prisma.organization.create({
      data: { slug: 'campaign-994', ownerId: other.id, positionId: 'pos-2' },
    })
    await service.prisma.campaign.create({
      data: {
        id: 994,
        organizationSlug: 'campaign-994',
        userId: other.id,
        slug: 'other-candidate',
        details: { state: 'TX', zip: '78634' },
        data: {},
      },
    })
    const row = await seedOutreach({ campaignId: 994 })

    const res = await post(row.id, ['5551234567'])

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
    expect(sendTestMessage).not.toHaveBeenCalled()
  })

  it('409s a row with no vendor job yet', async () => {
    const row = await seedOutreach({ projectId: null })

    const res = await post(row.id, ['5551234567'])

    expect(res.status).toBe(HttpStatus.CONFLICT)
    expect(sendTestMessage).not.toHaveBeenCalled()
  })

  it('409s a canceled row', async () => {
    const row = await seedOutreach({ status: OutreachStatus.canceled })

    const res = await post(row.id, ['5551234567'])

    expect(res.status).toBe(HttpStatus.CONFLICT)
  })

  it('400s a row with no Peerly identity', async () => {
    const row = await seedOutreach({ identityId: null })

    const res = await post(row.id, ['5551234567'])

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('404s when the flag is off', async () => {
    const row = await seedOutreach()
    flagEnabled.mockResolvedValue(false)

    const res = await post(row.id, ['5551234567'])

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
    expect(sendTestMessage).not.toHaveBeenCalled()
  })

  it('cools off a rapid second request for the same row', async () => {
    const row = await seedOutreach()

    const first = await post(row.id, ['5551234567'])
    const second = await post(row.id, ['5559876543'])

    expect(first.status).toBe(HttpStatus.CREATED)
    expect(second.status).toBe(HttpStatus.CONFLICT)
    expect(sendTestMessage).toHaveBeenCalledTimes(1)
  })
})
