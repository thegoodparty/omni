import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { PeerlyP2pJobService } from '@/vendors/peerly/services/peerlyP2pJob.service'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { OutreachStatus, OutreachType } from '../../generated/prisma'

const service = useTestService()

const updatePeerlyP2pJob = vi.fn()
const getFileBytesWithContentType = vi.fn()

let orgSlug: string
let campaignId: number

beforeEach(async () => {
  updatePeerlyP2pJob.mockReset().mockResolvedValue(undefined)
  getFileBytesWithContentType.mockReset().mockResolvedValue({
    bytes: Buffer.from('image-bytes'),
    contentType: 'image/png',
  })

  const peerly = service.app.get(PeerlyP2pJobService)
  vi.spyOn(peerly, 'updatePeerlyP2pJob').mockImplementation(updatePeerlyP2pJob)
  const s3 = service.app.get(S3Service)
  vi.spyOn(s3, 'getFileBytesWithContentType').mockImplementation(
    getFileBytesWithContentType,
  )

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
      slug: 'jane-doe-update',
      details: { state: 'TX', zip: '78634' },
      data: {},
      aiContent: {},
    },
  })
})

const seedOutreach = (
  overrides: Partial<{
    status: OutreachStatus
    outreachType: OutreachType
    projectId: string | null
    identityId: string | null
    imageUrl: string | null
  }> = {},
) =>
  service.prisma.outreach.create({
    data: {
      campaignId,
      outreachType: OutreachType.p2p,
      name: 'Likely voters — SMS',
      script: 'Hello {first_name}, old text.\n\nReply STOP to opt out.',
      status: OutreachStatus.pending,
      projectId: 'peerly-job-1',
      identityId: 'identity-1',
      date: new Date('2026-09-10T15:00:00Z'),
      scheduledLocalDate: '2026-09-10',
      imageUrl:
        'https://assets.goodparty.org/scheduled-campaign/jane/p2p/img.png',
      ...overrides,
    },
  })

const patchUpdate = (
  id: number,
  body: Partial<{ name: string; script: string; date: string }> = {},
) =>
  service.client.patch(
    `/v1/outreach/${id}`,
    {
      name: 'Renamed — SMS',
      script: 'Hello {first_name}, new text.\n\nReply STOP to opt out.',
      date: '2026-09-15T10:00:00-05:00',
      ...body,
    },
    { headers: { 'x-organization-slug': orgSlug } },
  )

describe('PATCH /v1/outreach/:id', () => {
  it('rejects every edit once the compliance launch switch is on', async () => {
    vi.stubEnv('SMS_COMPLIANCE_V2_ENABLED', 'true')
    const row = await seedOutreach()
    const res = await patchUpdate(row.id, { name: 'Edited name' })
    expect(res.status).toBe(400)
    const unchanged = await service.prisma.outreach.findFirstOrThrow({
      where: { id: row.id },
    })
    expect(unchanged.name).not.toBe('Edited name')
    vi.unstubAllEnvs()
  })

  it('updates the vendor job and the row, rescheduling on a date change', async () => {
    const row = await seedOutreach()

    const res = await patchUpdate(row.id)

    expect(res.status).toBe(HttpStatus.OK)
    expect(updatePeerlyP2pJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'peerly-job-1',
        identityId: 'identity-1',
        name: 'Renamed — SMS',
        scriptText: 'Hello {first_name}, new text.\n\nReply STOP to opt out.',
        rescheduleDate: '2026-09-15',
      }),
    )
    const updated = await service.prisma.outreach.findFirstOrThrow({
      where: { id: row.id },
    })
    expect(updated.name).toBe('Renamed — SMS')
    expect(updated.script).toBe(
      'Hello {first_name}, new text.\n\nReply STOP to opt out.',
    )
    expect(updated.scheduledLocalDate).toBe('2026-09-15')
    expect(updated.date?.toISOString()).toBe('2026-09-15T15:00:00.000Z')
  })

  it('keeps the schedule when the send day is unchanged', async () => {
    const row = await seedOutreach()

    const res = await patchUpdate(row.id, { date: '2026-09-10T11:00:00-04:00' })

    expect(res.status).toBe(HttpStatus.OK)
    expect(updatePeerlyP2pJob).toHaveBeenCalledWith(
      expect.objectContaining({ rescheduleDate: undefined }),
    )
  })

  it('rejects a row that is not scheduled-not-sent', async () => {
    const row = await seedOutreach({ status: OutreachStatus.completed })

    const res = await patchUpdate(row.id)

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(updatePeerlyP2pJob).not.toHaveBeenCalled()
  })

  it('rejects a row with no vendor job', async () => {
    const row = await seedOutreach({ projectId: null })

    const res = await patchUpdate(row.id)

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(updatePeerlyP2pJob).not.toHaveBeenCalled()
  })

  it('leaves the row untouched when the vendor update fails', async () => {
    updatePeerlyP2pJob.mockRejectedValue(new Error('peerly down'))
    const row = await seedOutreach()

    const res = await patchUpdate(row.id)

    expect(res.status).toBeGreaterThanOrEqual(500)
    const unchanged = await service.prisma.outreach.findFirstOrThrow({
      where: { id: row.id },
    })
    expect(unchanged.name).toBe('Likely voters — SMS')
    expect(unchanged.scheduledLocalDate).toBe('2026-09-10')
  })
})
