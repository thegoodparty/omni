import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { PeerlyP2pJobService } from '@/vendors/peerly/services/peerlyP2pJob.service'
import { SlackService } from '@/vendors/slack/services/slack.service'
import { AnalyticsService } from '@/analytics/analytics.service'
import { S3Service } from 'src/vendors/aws/services/s3.service'
import { OutreachStatus, OutreachType, UserRole } from '../../generated/prisma'

const service = useTestService()

const requestCanvassers = vi.fn()
const clearCanvassers = vi.fn()
const getJobsByIdentityId = vi.fn()
const getJob = vi.fn()
const getJobDetailedStats = vi.fn()
const slackMessage = vi.fn()
const track = vi.fn()

let campaignId: number
let orgSlug: string

const liveJob = (id: string, approved = false) => ({
  id,
  status: 'active',
  deliverability_check_error: undefined,
  has_canvassers_scheduled: approved,
  canvassers_schedule: approved ? { approved: true } : undefined,
  leads_remaining: 1200,
})

beforeEach(async () => {
  requestCanvassers.mockReset().mockResolvedValue(undefined)
  clearCanvassers.mockReset().mockResolvedValue(undefined)
  getJobsByIdentityId.mockReset().mockResolvedValue([])
  getJob.mockReset().mockResolvedValue(liveJob('peerly-job-1'))
  getJobDetailedStats.mockReset().mockResolvedValue({
    sentTotal: 100,
    receivedTotal: 4,
    delivered: 90,
    deliveryFailed: 6,
    deliveryUnconfirmed: 4,
    totalCost: 3.5,
  })
  slackMessage.mockReset().mockResolvedValue(undefined)
  track.mockReset().mockResolvedValue(undefined)

  const peerly = service.app.get(PeerlyP2pJobService)
  vi.spyOn(peerly, 'requestCanvassers').mockImplementation(requestCanvassers)
  vi.spyOn(peerly, 'clearCanvassers').mockImplementation(clearCanvassers)
  vi.spyOn(peerly, 'getJobsByIdentityId').mockImplementation(
    getJobsByIdentityId,
  )
  vi.spyOn(peerly, 'getJob').mockImplementation(getJob)
  vi.spyOn(peerly, 'getJobDetailedStats').mockImplementation(
    getJobDetailedStats,
  )
  vi.spyOn(service.app.get(SlackService), 'message').mockImplementation(
    slackMessage,
  )
  vi.spyOn(service.app.get(AnalyticsService), 'track').mockImplementation(track)

  // AdminOrM2MGuard reads the session user's CURRENT roles.
  await service.prisma.user.update({
    where: { id: service.user.id },
    data: { roles: [UserRole.admin] },
  })

  campaignId = 995
  orgSlug = `campaign-${campaignId}`
  await service.prisma.organization.create({
    data: { slug: orgSlug, ownerId: service.user.id, positionId: 'pos-1' },
  })
  await service.prisma.campaign.create({
    data: {
      id: campaignId,
      organizationSlug: orgSlug,
      userId: service.user.id,
      slug: 'jane-doe-admin',
      details: { state: 'TX', zip: '78634' },
      data: {},
      aiContent: {},
    },
  })
  await service.prisma.tcrCompliance.create({
    data: {
      id: `tcr-admin-${campaignId}`,
      campaignId,
      email: 'jane@example.org',
      phone: '15551234567',
      ein: '84-3917265',
      postalAddress: '1 Main St, Austin, TX 78634',
      filingUrl: 'https://example.org/filing',
      websiteDomain: '',
      officeLevel: 'local',
      committeeName: 'Friends of Jane',
      candidateName: 'Jane Doe',
      peerlyIdentityId: 'identity-1',
    },
  })
})

const seedOutreach = (
  overrides: Partial<{
    status: OutreachStatus
    outreachType: OutreachType
    projectId: string | null
    identityId: string | null
    approvedAt: Date | null
    deniedAt: Date | null
    script: string
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
      date: new Date('2026-09-10T15:00:00Z'),
      scheduledLocalDate: '2026-09-10',
      textCount: 1200,
      billableTextCount: 1200,
      ...overrides,
    },
  })

describe('CAS SMS console (gp-api admin surface)', () => {
  describe('GET /v1/outreach/admin/sms/queue', () => {
    it('lists scheduled sends with standards verdict and live job state', async () => {
      const row = await seedOutreach()
      getJobsByIdentityId.mockResolvedValue([liveJob('peerly-job-1')])

      const res = await service.client.get('/v1/outreach/admin/sms/queue')

      expect(res.status).toBe(HttpStatus.OK)
      expect(res.data.items).toHaveLength(1)
      const item = res.data.items[0]
      expect(item.id).toBe(row.id)
      expect(item.approvalStatus).toBe('awaiting_review')
      expect(item.standards).toEqual({ passed: true, failures: [] })
      expect(item.job).toMatchObject({
        status: 'active',
        hasCanvassersScheduled: false,
      })
    })

    it('flags standards failures and survives a vendor read failure', async () => {
      await seedOutreach({
        script: 'vote for someone, no opt out line here',
      })
      getJobsByIdentityId.mockRejectedValue(new Error('peerly down'))

      const res = await service.client.get('/v1/outreach/admin/sms/queue')

      expect(res.status).toBe(HttpStatus.OK)
      const item = res.data.items[0]
      expect(item.standards.passed).toBe(false)
      expect(item.standards.failures).toEqual(
        expect.arrayContaining([
          'opt_out_line',
          'first_name_token',
          'candidate_name',
          'paid_for_by',
        ]),
      )
      expect(item.job).toBeNull()
    })

    it('excludes rows outside the review window', async () => {
      await seedOutreach({ status: OutreachStatus.completed })
      await seedOutreach({ projectId: null })
      await seedOutreach({ outreachType: OutreachType.text })

      const res = await service.client.get('/v1/outreach/admin/sms/queue')

      expect(res.status).toBe(HttpStatus.OK)
      expect(res.data.items).toHaveLength(0)
    })

    it('is admin-gated', async () => {
      await service.prisma.user.update({
        where: { id: service.user.id },
        data: { roles: [UserRole.candidate] },
      })
      const res = await service.client.get('/v1/outreach/admin/sms/queue')
      expect(res.status).toBe(HttpStatus.FORBIDDEN)
    })
  })

  describe('POST /v1/outreach/admin/sms/:id/approve', () => {
    it('requests canvassers, stamps the row, notifies, and tracks', async () => {
      const row = await seedOutreach()

      const res = await service.client.post(
        `/v1/outreach/admin/sms/${row.id}/approve`,
        { approvedBy: 'cas@goodparty.org', initials: 'CW' },
      )

      expect(res.status).toBe(HttpStatus.CREATED)
      expect(requestCanvassers).toHaveBeenCalledWith('peerly-job-1', {
        initials: 'CW',
        date: '2026-09-10',
      })
      expect(res.data.approvalStatus).toBe('canvass_requested')
      const updated = await service.prisma.outreach.findFirstOrThrow({
        where: { id: row.id },
      })
      expect(updated.approvedBy).toBe('cas@goodparty.org')
      expect(updated.approvedAt).not.toBeNull()
      expect(updated.canvassRequestedAt).not.toBeNull()
      expect(slackMessage).toHaveBeenCalled()
      expect(track).toHaveBeenCalledWith(
        service.user.id,
        'Voter Outreach - Campaign Approved',
        { channel: 'sms' },
      )
    })

    it('reverts the claim when the vendor call fails', async () => {
      requestCanvassers.mockRejectedValue(new Error('peerly down'))
      const row = await seedOutreach()

      const res = await service.client.post(
        `/v1/outreach/admin/sms/${row.id}/approve`,
        { approvedBy: 'cas@goodparty.org', initials: 'CW' },
      )

      expect(res.status).toBeGreaterThanOrEqual(500)
      const unchanged = await service.prisma.outreach.findFirstOrThrow({
        where: { id: row.id },
      })
      expect(unchanged.approvedAt).toBeNull()
      expect(unchanged.canvassRequestedAt).toBeNull()
    })

    it('409s a second approve', async () => {
      const row = await seedOutreach()
      await service.client.post(`/v1/outreach/admin/sms/${row.id}/approve`, {
        approvedBy: 'cas@goodparty.org',
        initials: 'CW',
      })
      const again = await service.client.post(
        `/v1/outreach/admin/sms/${row.id}/approve`,
        { approvedBy: 'other@goodparty.org', initials: 'OT' },
      )
      expect(again.status).toBe(HttpStatus.CONFLICT)
      expect(requestCanvassers).toHaveBeenCalledTimes(1)
    })
  })

  describe('POST /v1/outreach/admin/sms/:id/deny', () => {
    it('stamps the denial internally without contacting the candidate', async () => {
      const row = await seedOutreach()

      const res = await service.client.post(
        `/v1/outreach/admin/sms/${row.id}/deny`,
        { deniedBy: 'cas@goodparty.org', reason: 'Broken link in message' },
      )

      expect(res.status).toBe(HttpStatus.CREATED)
      expect(res.data.approvalStatus).toBe('denied')
      expect(res.data.deniedReason).toBe('Broken link in message')
      expect(requestCanvassers).not.toHaveBeenCalled()
    })

    it('409s denying an approved row', async () => {
      const row = await seedOutreach({ approvedAt: new Date() })
      const res = await service.client.post(
        `/v1/outreach/admin/sms/${row.id}/deny`,
        { deniedBy: 'cas@goodparty.org', reason: 'too late' },
      )
      expect(res.status).toBe(HttpStatus.CONFLICT)
    })
  })

  describe('PATCH /v1/outreach/admin/sms/:id (staff edit)', () => {
    const withImage = async (rowId: number) => {
      await service.prisma.outreach.update({
        where: { id: rowId },
        data: {
          imageUrl:
            'https://assets.goodparty.org/scheduled-campaign/jane/p2p/i.png',
        },
      })
      const s3 = service.app.get(S3Service)
      vi.spyOn(s3, 'getFileBytesWithContentType').mockResolvedValue({
        bytes: Buffer.from('img'),
        contentType: 'image/png',
      })
      const peerly = service.app.get(PeerlyP2pJobService)
      const updateJob = vi
        .spyOn(peerly, 'updatePeerlyP2pJob')
        .mockResolvedValue(undefined)
      return updateJob
    }

    it('updates the message, stamps the editor, and clears a denial', async () => {
      const row = await seedOutreach({ deniedAt: new Date() })
      await service.prisma.outreach.update({
        where: { id: row.id },
        data: { deniedBy: 'cas@goodparty.org', deniedReason: 'typo' },
      })
      const updateJob = await withImage(row.id)
      const script =
        'Hello {first_name}, this is Jane — fixed.\n\nReply STOP to opt out.'

      const res = await service.client.patch(
        `/v1/outreach/admin/sms/${row.id}`,
        { script, editedBy: 'cas@goodparty.org' },
      )

      expect(res.status).toBe(HttpStatus.OK)
      expect(res.data.approvalStatus).toBe('awaiting_review')
      expect(updateJob).toHaveBeenCalledWith(
        expect.objectContaining({
          jobId: 'peerly-job-1',
          scriptText: script,
        }),
      )
      const updated = await service.prisma.outreach.findFirstOrThrow({
        where: { id: row.id },
      })
      expect(updated.script).toBe(script)
      expect(updated.deniedAt).toBeNull()
      expect(updated.deniedReason).toBeNull()
      expect(updated.adminEditedBy).toBe('cas@goodparty.org')
      expect(updated.adminEditedAt).not.toBeNull()
      expect(slackMessage).toHaveBeenCalled()
    })

    it('keeps an existing booking and approval intact', async () => {
      const row = await seedOutreach({ approvedAt: new Date() })
      await service.prisma.outreach.update({
        where: { id: row.id },
        data: {
          approvedBy: 'cas@goodparty.org',
          canvassRequestedAt: new Date(),
        },
      })
      await withImage(row.id)

      const res = await service.client.patch(
        `/v1/outreach/admin/sms/${row.id}`,
        { script: 'edited', editedBy: 'cas@goodparty.org' },
      )

      expect(res.status).toBe(HttpStatus.OK)
      expect(clearCanvassers).not.toHaveBeenCalled()
      const updated = await service.prisma.outreach.findFirstOrThrow({
        where: { id: row.id },
      })
      expect(updated.script).toBe('edited')
      expect(updated.approvedAt).not.toBeNull()
      expect(updated.canvassRequestedAt).not.toBeNull()
      expect(updated.adminEditedBy).toBe('cas@goodparty.org')
    })

    it('400s a campaign with no stored image', async () => {
      const row = await seedOutreach()
      const res = await service.client.patch(
        `/v1/outreach/admin/sms/${row.id}`,
        { script: 'edited', editedBy: 'cas@goodparty.org' },
      )
      expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    })
  })

  describe('GET /v1/outreach/admin/sms/:id', () => {
    it('merges the live job and stats onto the row', async () => {
      const row = await seedOutreach()

      const res = await service.client.get(`/v1/outreach/admin/sms/${row.id}`)

      expect(res.status).toBe(HttpStatus.OK)
      expect(res.data.item.id).toBe(row.id)
      expect(res.data.item.job).toMatchObject({ status: 'active' })
      expect(res.data.stats).toMatchObject({ delivered: 90, totalCost: 3.5 })
    })

    it('renders without stats when the vendor read fails', async () => {
      getJobDetailedStats.mockRejectedValue(new Error('peerly down'))
      const row = await seedOutreach()

      const res = await service.client.get(`/v1/outreach/admin/sms/${row.id}`)

      expect(res.status).toBe(HttpStatus.OK)
      expect(res.data.stats).toBeNull()
    })
  })

  describe('edit interplay (PATCH /v1/outreach/:id)', () => {
    it('clears the canvass request and resets approval on edit', async () => {
      const row = await seedOutreach({ approvedAt: new Date() })
      await service.prisma.outreach.update({
        where: { id: row.id },
        data: {
          approvedBy: 'cas@goodparty.org',
          canvassRequestedAt: new Date(),
        },
      })
      // The edit path re-reads the stored image from S3; give it bytes.
      await service.prisma.outreach.update({
        where: { id: row.id },
        data: {
          imageUrl:
            'https://assets.goodparty.org/scheduled-campaign/jane/p2p/i.png',
        },
      })
      const s3 = service.app.get(S3Service)
      vi.spyOn(s3, 'getFileBytesWithContentType').mockResolvedValue({
        bytes: Buffer.from('img'),
        contentType: 'image/png',
      })
      const peerly = service.app.get(PeerlyP2pJobService)
      vi.spyOn(peerly, 'updatePeerlyP2pJob').mockResolvedValue(undefined)

      const res = await service.client.patch(
        `/v1/outreach/${row.id}`,
        {
          name: 'Edited name',
          script: 'Hello {first_name}, edited.\n\nReply STOP to opt out.',
          date: '2026-09-12T10:00:00-05:00',
        },
        { headers: { 'x-organization-slug': orgSlug } },
      )

      expect(res.status).toBe(HttpStatus.OK)
      expect(clearCanvassers).toHaveBeenCalledWith('peerly-job-1')
      const updated = await service.prisma.outreach.findFirstOrThrow({
        where: { id: row.id },
      })
      expect(updated.approvedAt).toBeNull()
      expect(updated.approvedBy).toBeNull()
      expect(updated.canvassRequestedAt).toBeNull()
    })

    it('fails closed when the canvass clear fails', async () => {
      clearCanvassers.mockRejectedValue(new Error('peerly down'))
      const row = await seedOutreach({ approvedAt: new Date() })
      await service.prisma.outreach.update({
        where: { id: row.id },
        data: {
          canvassRequestedAt: new Date(),
          approvedBy: 'cas@gp.org',
          imageUrl:
            'https://assets.goodparty.org/scheduled-campaign/jane/p2p/i.png',
        },
      })
      const s3 = service.app.get(S3Service)
      vi.spyOn(s3, 'getFileBytesWithContentType').mockResolvedValue({
        bytes: Buffer.from('img'),
        contentType: 'image/png',
      })

      const res = await service.client.patch(
        `/v1/outreach/${row.id}`,
        {
          name: 'Edited name',
          script: 'Hello {first_name}, edited.\n\nReply STOP to opt out.',
          date: '2026-09-12T10:00:00-05:00',
        },
        { headers: { 'x-organization-slug': orgSlug } },
      )

      expect(res.status).toBeGreaterThanOrEqual(500)
      const unchanged = await service.prisma.outreach.findFirstOrThrow({
        where: { id: row.id },
      })
      expect(unchanged.name).toBe('Likely voters — SMS')
      expect(unchanged.approvedAt).not.toBeNull()
    })
  })
})
