import { BadGatewayException, HttpStatus } from '@nestjs/common'
import { addDays, format } from 'date-fns'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { PeerlyP2pJobService } from '@/vendors/peerly/services/peerlyP2pJob.service'
import { OutreachStatus, OutreachType, UserRole } from '../../generated/prisma'

const service = useTestService()

const SEND_DATE = addDays(new Date(), 7)
const SEND_LOCAL_DATE = format(SEND_DATE, 'yyyy-MM-dd')

const listTestJobIds = vi.fn()
const createTestJob = vi.fn()
const sendTestMessage = vi.fn()

let campaignId: number
let orgSlug: string

afterEach(() => {
  vi.unstubAllEnvs()
})

beforeEach(async () => {
  listTestJobIds.mockReset().mockResolvedValue([])
  createTestJob.mockReset().mockResolvedValue('test-job-1')
  sendTestMessage.mockReset().mockResolvedValue(undefined)

  const peerly = service.app.get(PeerlyP2pJobService)
  vi.spyOn(peerly, 'listTestJobIds').mockImplementation(listTestJobIds)
  vi.spyOn(peerly, 'createTestJob').mockImplementation(createTestJob)
  vi.spyOn(peerly, 'sendTestMessage').mockImplementation(sendTestMessage)

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
    expect(sendTestMessage).toHaveBeenCalledWith('test-job-1', '5551234567')
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
    expect(sendTestMessage).toHaveBeenCalledWith('test-job-9', '5551234567')
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
})
