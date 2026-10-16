import {
  BadGatewayException,
  ConflictException,
  HttpStatus,
} from '@nestjs/common'
import {
  AxiosError,
  AxiosHeaders,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios'
import { addDays, format, subDays } from 'date-fns'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { PeerlyHttpService } from '@/vendors/peerly/services/peerlyHttp.service'
import { PeerlyP2pJobService } from '@/vendors/peerly/services/peerlyP2pJob.service'
import { PeerlyPhoneListService } from '@/vendors/peerly/services/peerlyPhoneList.service'
import { PeerlyTestListService } from '@/vendors/peerly/services/peerlyTestList.service'
import { PhoneListState } from '@/vendors/peerly/peerly.types'
import { OutreachStatus, OutreachType, UserRole } from '../../generated/prisma'

const service = useTestService()

const SEND_DATE = addDays(new Date(), 7)
const SEND_LOCAL_DATE = format(SEND_DATE, 'yyyy-MM-dd')

const listTestJobIds = vi.fn()
const createTestJob = vi.fn()
const sendTestMessage = vi.fn()
const resolveTestListId = vi.fn()

let campaignId: number
let orgSlug: string

afterEach(() => {
  vi.unstubAllEnvs()
})

beforeEach(async () => {
  listTestJobIds.mockReset().mockResolvedValue([])
  createTestJob.mockReset().mockResolvedValue('test-job-1')
  sendTestMessage.mockReset().mockResolvedValue(undefined)
  resolveTestListId.mockReset().mockResolvedValue(169614)

  const peerly = service.app.get(PeerlyP2pJobService)
  vi.spyOn(peerly, 'listTestJobIds').mockImplementation(listTestJobIds)
  vi.spyOn(peerly, 'createTestJob').mockImplementation(createTestJob)
  vi.spyOn(peerly, 'sendTestMessage').mockImplementation(sendTestMessage)

  const testLists = service.app.get(PeerlyTestListService)
  vi.spyOn(testLists, 'resolveTestListId').mockImplementation(resolveTestListId)

  // AdminOrM2MGuard reads the session user's CURRENT roles.
  await service.prisma.user.update({
    where: { id: service.user.id },
    data: { roles: [UserRole.admin] },
  })

  campaignId = 996
  orgSlug = `campaign-${campaignId}`
  await service.prisma.organization.create({
    data: { slug: orgSlug, ownerId: service.user.id, positionId: 'pos-1' },
  })
  await service.prisma.campaign.create({
    data: {
      id: campaignId,
      organizationSlug: orgSlug,
      userId: service.user.id,
      slug: 'jane-doe-test-send',
      details: { state: 'TX', zip: '78634' },
      data: {},
      aiContent: {},
    },
  })
})

const seedOutreach = (
  overrides: Partial<{
    status: OutreachStatus
    projectId: string | null
    identityId: string | null
    canvassRequestedAt: Date | null
    date: Date
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
      script:
        'Hello {first_name}, this is Jane, candidate for City Council. ' +
        'Vote!\n\nPaid for by Friends of Jane.\nReply STOP to opt out.',
      date: SEND_DATE,
      scheduledLocalDate: SEND_LOCAL_DATE,
      textCount: 1200,
      billableTextCount: 1200,
      ...overrides,
    },
  })

// The bodies Peerly returned in prod for these refusals (ENG-11262).
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

// Drives the real test-list and send code against a Peerly that refuses
// only the call whose path ends with `failingPath`.
const usePeerlyStub = (failingPath: string, error: AxiosError) => {
  vi.mocked(service.app.get(PeerlyP2pJobService).sendTestMessage).mockRestore()
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
  return vi
    .spyOn(service.app.get(PeerlyHttpService), 'post')
    .mockImplementation(async (path: string) => {
      if (path.endsWith(failingPath)) throw error
      return { data: {} } as AxiosResponse
    })
}

describe('POST /v1/outreach/admin/sms/:id/test', () => {
  it('creates the test job and sends to the normalized phone', async () => {
    const row = await seedOutreach()

    const res = await service.client.post(
      `/v1/outreach/admin/sms/${row.id}/test`,
      { phone: '+15551234567' },
    )

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data).toEqual({ sent: true })
    expect(listTestJobIds).toHaveBeenCalledWith('peerly-job-1')
    expect(createTestJob).toHaveBeenCalledWith('peerly-job-1')
    expect(resolveTestListId).toHaveBeenCalledWith({
      identityId: 'identity-1',
      phone: '5551234567',
    })
    expect(sendTestMessage).toHaveBeenCalledWith(
      'test-job-1',
      '5551234567',
      169614,
    )
  })

  it('400s a number Peerly says is not a cell, without sending', async () => {
    const row = await seedOutreach()
    const post = usePeerlyStub(
      '/addcontact',
      peerlyError(HttpStatus.FORBIDDEN, 'Not a cell number.'),
    )

    const res = await service.client.post(
      `/v1/outreach/admin/sms/${row.id}/test`,
      { phone: '5551234567' },
    )

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(res.data.message).toContain('not one')
    expect(post).toHaveBeenCalledTimes(1)
  })

  it.each([
    "test_contact_phone '5551234567' not in test_list_id '169614'.",
    'Lead already exists in leads table',
  ])('400s a send Peerly refuses with "%s"', async (message) => {
    const row = await seedOutreach()
    usePeerlyStub(
      '/send_test_message',
      peerlyError(HttpStatus.BAD_REQUEST, message),
    )

    const res = await service.client.post(
      `/v1/outreach/admin/sms/${row.id}/test`,
      { phone: '5551234567' },
    )

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(res.data.message).toContain('Try a different number')
  })

  it('keeps a 400 caused by our own request a 502', async () => {
    const row = await seedOutreach()
    usePeerlyStub(
      '/send_test_message',
      peerlyError(
        HttpStatus.BAD_REQUEST,
        "'test_list_id' is a required parameter",
      ),
    )

    const res = await service.client.post(
      `/v1/outreach/admin/sms/${row.id}/test`,
      { phone: '5551234567' },
    )

    expect(res.status).toBe(HttpStatus.BAD_GATEWAY)
  })

  it('reuses an existing test job on a repeat send', async () => {
    vi.stubEnv('TEST_SEND_COOLDOWN_MS', '0')
    const row = await seedOutreach()
    listTestJobIds.mockResolvedValue(['test-job-9'])

    const first = await service.client.post(
      `/v1/outreach/admin/sms/${row.id}/test`,
      { phone: '5551234567' },
    )
    const second = await service.client.post(
      `/v1/outreach/admin/sms/${row.id}/test`,
      { phone: '5551234567' },
    )

    expect(first.status).toBe(HttpStatus.CREATED)
    expect(second.status).toBe(HttpStatus.CREATED)
    expect(createTestJob).not.toHaveBeenCalled()
    expect(sendTestMessage).toHaveBeenCalledTimes(2)
    expect(sendTestMessage).toHaveBeenCalledWith(
      'test-job-9',
      '5551234567',
      169614,
    )
  })

  it('400s a sent row without touching the vendor', async () => {
    const row = await seedOutreach({
      status: OutreachStatus.completed,
      canvassRequestedAt: subDays(new Date(), 3),
      date: subDays(new Date(), 2),
    })

    const res = await service.client.post(
      `/v1/outreach/admin/sms/${row.id}/test`,
      { phone: '5551234567' },
    )

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(createTestJob).not.toHaveBeenCalled()
    expect(sendTestMessage).not.toHaveBeenCalled()
  })

  it('rejects a non-US phone without touching the vendor', async () => {
    const row = await seedOutreach()

    // Passes the contract's E.164-ish shape but is not a US number.
    const nonUs = await service.client.post(
      `/v1/outreach/admin/sms/${row.id}/test`,
      { phone: '+445551234567' },
    )
    expect(nonUs.status).toBe(HttpStatus.BAD_REQUEST)

    // Fails the contract shape outright.
    const malformed = await service.client.post(
      `/v1/outreach/admin/sms/${row.id}/test`,
      { phone: '555-1234' },
    )
    expect(malformed.status).toBe(HttpStatus.BAD_REQUEST)

    expect(listTestJobIds).not.toHaveBeenCalled()
    expect(sendTestMessage).not.toHaveBeenCalled()
  })

  it('refuses a canceled row, whose vendor job is deleted', async () => {
    const row = await seedOutreach({ status: OutreachStatus.canceled })

    const res = await service.client.post(
      `/v1/outreach/admin/sms/${row.id}/test`,
      { phone: '5551234567' },
    )

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(sendTestMessage).not.toHaveBeenCalled()
  })

  it('404s a row with no vendor job', async () => {
    const row = await seedOutreach({ projectId: null })

    const res = await service.client.post(
      `/v1/outreach/admin/sms/${row.id}/test`,
      { phone: '5551234567' },
    )

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
    expect(sendTestMessage).not.toHaveBeenCalled()
  })

  it('is admin-gated', async () => {
    const row = await seedOutreach()
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { roles: [UserRole.candidate] },
    })

    const res = await service.client.post(
      `/v1/outreach/admin/sms/${row.id}/test`,
      { phone: '5551234567' },
    )

    expect(res.status).toBe(HttpStatus.FORBIDDEN)
    expect(sendTestMessage).not.toHaveBeenCalled()
  })

  it('cools off a rapid second send for the same row', async () => {
    const row = await seedOutreach()
    listTestJobIds.mockResolvedValue(['test-job-9'])

    const first = await service.client.post(
      `/v1/outreach/admin/sms/${row.id}/test`,
      { phone: '5551234567' },
    )
    const second = await service.client.post(
      `/v1/outreach/admin/sms/${row.id}/test`,
      { phone: '5551234567' },
    )

    expect(first.status).toBe(HttpStatus.CREATED)
    expect(second.status).toBe(HttpStatus.CONFLICT)
    expect(sendTestMessage).toHaveBeenCalledTimes(1)
  })

  it('releases the cool-off claim when the vendor send fails', async () => {
    const row = await seedOutreach()
    listTestJobIds.mockResolvedValue(['test-job-9'])
    sendTestMessage.mockRejectedValueOnce(
      new BadGatewayException('Peerly API error: no agents available'),
    )

    const failed = await service.client.post(
      `/v1/outreach/admin/sms/${row.id}/test`,
      { phone: '5551234567' },
    )
    expect(failed.status).toBe(HttpStatus.BAD_GATEWAY)

    const retried = await service.client.post(
      `/v1/outreach/admin/sms/${row.id}/test`,
      { phone: '5551234567' },
    )
    expect(retried.status).toBe(HttpStatus.CREATED)
    expect(sendTestMessage).toHaveBeenCalledTimes(2)
  })
  it('tells the reviewer to retry while the test list is still being prepared', async () => {
    const row = await seedOutreach()
    resolveTestListId.mockRejectedValueOnce(
      new ConflictException(
        'Peerly is still preparing this campaign\u2019s test list',
      ),
    )

    const first = await service.client.post(
      `/v1/outreach/admin/sms/${row.id}/test`,
      { phone: '5551234567' },
    )
    expect(first.status).toBe(HttpStatus.CONFLICT)
    expect(sendTestMessage).not.toHaveBeenCalled()

    // The claim is released, so the retry the message asks for is allowed
    // through immediately rather than hitting the cool-off.
    const retried = await service.client.post(
      `/v1/outreach/admin/sms/${row.id}/test`,
      { phone: '5551234567' },
    )
    expect(retried.status).toBe(HttpStatus.CREATED)
  })

  it('400s a row with no Peerly identity, before any vendor call', async () => {
    const row = await seedOutreach({ identityId: null })

    const res = await service.client.post(
      `/v1/outreach/admin/sms/${row.id}/test`,
      { phone: '5551234567' },
    )

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(resolveTestListId).not.toHaveBeenCalled()
    expect(sendTestMessage).not.toHaveBeenCalled()
  })
})
