import { BadGatewayException, HttpStatus } from '@nestjs/common'
import { addDays, subMinutes } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { FeaturesService } from '@/features/services/features.service'
import { PeerlyP2pJobService } from '@/vendors/peerly/services/peerlyP2pJob.service'
import { P2P_ERROR_MESSAGES } from '@/vendors/peerly/constants/p2pJob.constants'
import { SlackService } from '@/vendors/slack/services/slack.service'
import { S3Service } from 'src/vendors/aws/services/s3.service'
import { EASTERN_TIMEZONE } from 'src/shared/util/date.util'
import { WIN_SMS_PREVIEW_EDIT_FLAG } from '@/shared/util/winSmsPreviewEditFlag.util'
import { OutreachStatus, OutreachType, UserRole } from '../../generated/prisma'

const service = useTestService()

const SEND_AT = addDays(new Date(), 5)
const OLD_SCRIPT =
  'Hello {first_name}, this is Jane, candidate for City Council.\n\n' +
  'Paid for by Friends of Jane.\nReply STOP to opt out.'
const NEW_SCRIPT =
  'Hi {first_name}, Jane here. I would love your vote on Nov 3.\n\n' +
  'Paid for by Friends of Jane.\nReply STOP to opt out.'

const updatePeerlyP2pJob = vi.fn()
const requestCanvassers = vi.fn()
const activateJob = vi.fn()
const slackMessage = vi.fn()

let campaignId: number
let orgSlug: string

beforeEach(async () => {
  updatePeerlyP2pJob.mockReset().mockResolvedValue(undefined)
  requestCanvassers.mockReset().mockResolvedValue(undefined)
  activateJob.mockReset().mockResolvedValue(undefined)
  slackMessage.mockReset().mockResolvedValue(undefined)

  const peerly = service.app.get(PeerlyP2pJobService)
  vi.spyOn(peerly, 'updatePeerlyP2pJob').mockImplementation(updatePeerlyP2pJob)
  vi.spyOn(peerly, 'requestCanvassers').mockImplementation(requestCanvassers)
  vi.spyOn(peerly, 'activateJob').mockImplementation(activateJob)
  vi.spyOn(service.app.get(SlackService), 'message').mockImplementation(
    slackMessage,
  )
  vi.spyOn(
    service.app.get(S3Service),
    'getFileBytesWithContentType',
  ).mockResolvedValue({ bytes: Buffer.from('img'), contentType: 'image/png' })

  // The same session user approves through the admin console in the
  // approve tests (AdminOrM2MGuard reads current roles).
  await service.prisma.user.update({
    where: { id: service.user.id },
    data: { roles: [UserRole.admin] },
  })

  campaignId = 994
  orgSlug = `campaign-${campaignId}`
  await service.prisma.organization.create({
    data: { slug: orgSlug, ownerId: service.user.id, positionId: 'pos-1' },
  })
  await service.prisma.campaign.create({
    data: {
      id: campaignId,
      organizationSlug: orgSlug,
      userId: service.user.id,
      slug: 'jane-doe-edit',
      details: { state: 'TX', zip: '78634' },
      data: {},
    },
  })
})

const seedOutreach = (
  overrides: Partial<{
    campaignId: number
    status: OutreachStatus
    approvedAt: Date | null
    canvassRequestedAt: Date | null
    deniedAt: Date | null
    deniedReason: string | null
    candidateEditClaimedAt: Date | null
    script: string
    message: string
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
      imageUrl: 'https://assets.goodparty.org/scheduled-campaign/j/p2p/i.png',
      script: OLD_SCRIPT,
      message: OLD_SCRIPT,
      date: SEND_AT,
      scheduledLocalDate: formatInTimeZone(
        SEND_AT,
        EASTERN_TIMEZONE,
        'yyyy-MM-dd',
      ),
      textCount: 1200,
      billableTextCount: 1200,
      stripeCheckoutSessionId: 'cs_test_123',
      ...overrides,
    },
  })

const editScript = (id: number, script = NEW_SCRIPT) =>
  service.client.patch(
    `/v1/outreach/${id}/sms/script`,
    { script },
    { headers: { 'x-organization-slug': orgSlug } },
  )

const approve = (id: number) =>
  service.client.post(`/v1/outreach/admin/sms/${id}/approve`, {
    approvedBy: 'cas@goodparty.org',
  })

const readRow = (id: number) =>
  service.prisma.outreach.findFirstOrThrow({ where: { id } })

describe('PATCH /v1/outreach/:id/sms/script', () => {
  it('writes Peerly, swaps the script and posts the edit notice', async () => {
    const row = await seedOutreach()

    const res = await editScript(row.id)

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.script).toBe(NEW_SCRIPT)
    expect(res.data.isLockedForEdit).toBe(false)
    expect(res.data).not.toHaveProperty('approvedAt')
    expect(updatePeerlyP2pJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'peerly-job-1',
        campaignId,
        identityId: 'identity-1',
        scriptText: NEW_SCRIPT,
        imageInfo: expect.objectContaining({ fileName: 'i.png' }),
      }),
    )
    const updated = await readRow(row.id)
    expect(updated.script).toBe(NEW_SCRIPT)
    expect(updated.message).toBe(NEW_SCRIPT)
    expect(updated.candidateEditedAt).not.toBeNull()
    expect(updated.candidateEditClaimedAt).toBeNull()
    expect(slackMessage).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(slackMessage.mock.calls[0])).toContain(
      'P2P Campaign Edited by Candidate',
    )
  })

  it('returns a denied text to awaiting review', async () => {
    const row = await seedOutreach({
      deniedAt: new Date(),
      deniedReason: 'bad link',
    })

    const res = await editScript(row.id)

    expect(res.status).toBe(HttpStatus.OK)
    const updated = await readRow(row.id)
    expect(updated.deniedAt).toBeNull()
    expect(updated.deniedReason).toBeNull()
  })

  it('keeps the edit when the Slack notice fails', async () => {
    slackMessage.mockRejectedValue(new Error('slack down'))
    const row = await seedOutreach()

    const res = await editScript(row.id)

    expect(res.status).toBe(HttpStatus.OK)
    expect((await readRow(row.id)).script).toBe(NEW_SCRIPT)
  })

  it('rejects a new script that drops the Paid for by line', async () => {
    const row = await seedOutreach()

    const res = await editScript(
      row.id,
      'Hi {first_name}, Jane here. I would love your vote.\nReply STOP to opt out.',
    )

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(res.data.message).toBe('Keep the "Paid for by" line in your message')
    expect(updatePeerlyP2pJob).not.toHaveBeenCalled()
    const unchanged = await readRow(row.id)
    expect(unchanged.script).toBe(OLD_SCRIPT)
    expect(unchanged.candidateEditClaimedAt).toBeNull()
  })

  it('rejects a Paid for by line that no longer names the committee', async () => {
    await service.prisma.tcrCompliance.create({
      data: {
        id: `tcr-edit-${campaignId}`,
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
    const row = await seedOutreach()

    const res = await editScript(
      row.id,
      'Hi {first_name}, I would love your vote.\nPaid for by Someone Else.\nReply STOP to opt out.',
    )

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(updatePeerlyP2pJob).not.toHaveBeenCalled()
  })

  it('still edits a text whose saved script never had the line', async () => {
    const legacy = 'Hi {first_name}, Jane here.\nReply STOP to opt out.'
    const row = await seedOutreach({ script: legacy, message: legacy })

    const res = await editScript(
      row.id,
      'Hi {first_name}, Jane here. Vote Nov 3.\nReply STOP to opt out.',
    )

    expect(res.status).toBe(HttpStatus.OK)
    expect(updatePeerlyP2pJob).toHaveBeenCalledTimes(1)
  })

  it('refuses a text staff already approved', async () => {
    const row = await seedOutreach({ approvedAt: new Date() })

    const res = await editScript(row.id)

    expect(res.status).toBe(HttpStatus.CONFLICT)
    expect(updatePeerlyP2pJob).not.toHaveBeenCalled()
    expect((await readRow(row.id)).script).toBe(OLD_SCRIPT)
  })

  it('refuses a booked text', async () => {
    const row = await seedOutreach({ canvassRequestedAt: new Date() })

    const res = await editScript(row.id)

    expect(res.status).toBe(HttpStatus.CONFLICT)
    expect(updatePeerlyP2pJob).not.toHaveBeenCalled()
  })

  it('reports a locked text on the detail read', async () => {
    const row = await seedOutreach({ approvedAt: new Date() })

    const res = await service.client.get(`/v1/outreach/${row.id}`, {
      headers: { 'x-organization-slug': orgSlug },
    })

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.isLockedForEdit).toBe(true)
    expect(res.data).not.toHaveProperty('approvedAt')
    expect(res.data).not.toHaveProperty('canvassRequestedAt')
  })

  it("404s another campaign's text", async () => {
    const other = await service.prisma.user.create({
      data: { email: 'other@example.org', clerkId: 'user_other_edit' },
    })
    await service.prisma.organization.create({
      data: { slug: 'campaign-993', ownerId: other.id, positionId: 'pos-2' },
    })
    await service.prisma.campaign.create({
      data: {
        id: 993,
        organizationSlug: 'campaign-993',
        userId: other.id,
        slug: 'someone-else',
        details: { state: 'TX', zip: '78634' },
        data: {},
      },
    })
    const row = await seedOutreach({ campaignId: 993 })

    const res = await editScript(row.id)

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
    expect(updatePeerlyP2pJob).not.toHaveBeenCalled()
    expect((await readRow(row.id)).script).toBe(OLD_SCRIPT)
  })

  it('404s when the rollout flag is off', async () => {
    const flags = vi
      .spyOn(service.app.get(FeaturesService), 'isFeatureEnabled')
      .mockResolvedValue(false)
    onTestFinished(() => flags.mockRestore())
    const row = await seedOutreach()

    const res = await editScript(row.id)

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
    expect(flags.mock.calls.map(([params]) => params.feature)).toContain(
      WIN_SMS_PREVIEW_EDIT_FLAG,
    )
    expect(updatePeerlyP2pJob).not.toHaveBeenCalled()
  })

  it('refuses a second edit while one holds the claim', async () => {
    const row = await seedOutreach({ candidateEditClaimedAt: new Date() })

    const res = await editScript(row.id)

    expect(res.status).toBe(HttpStatus.CONFLICT)
    expect(updatePeerlyP2pJob).not.toHaveBeenCalled()
  })

  it('releases the claim and keeps the script when Peerly fails', async () => {
    updatePeerlyP2pJob.mockRejectedValue(
      new BadGatewayException(P2P_ERROR_MESSAGES.JOB_UPDATE_FAILED),
    )
    const row = await seedOutreach()

    const res = await editScript(row.id)

    expect(res.status).toBe(HttpStatus.BAD_GATEWAY)
    const after = await readRow(row.id)
    expect(after.script).toBe(OLD_SCRIPT)
    expect(after.candidateEditClaimedAt).toBeNull()
    expect(after.candidateEditedAt).toBeNull()
    expect(slackMessage).not.toHaveBeenCalled()
  })

  it('does not clear a newer claim when its own vendor write fails late', async () => {
    const row = await seedOutreach()
    // A slow Peerly write outlives its claim: another request takes the row
    // over before this one's failure rolls back.
    const newerClaim = addDays(new Date(), 1)
    updatePeerlyP2pJob.mockImplementation(async () => {
      await service.prisma.outreach.update({
        where: { id: row.id },
        data: { candidateEditClaimedAt: newerClaim },
      })
      throw new BadGatewayException(P2P_ERROR_MESSAGES.JOB_UPDATE_FAILED)
    })

    const res = await editScript(row.id)

    expect(res.status).toBe(HttpStatus.BAD_GATEWAY)
    expect((await readRow(row.id)).candidateEditClaimedAt).toEqual(newerClaim)
  })

  it('does not write over a claim taken while Peerly was writing', async () => {
    const row = await seedOutreach()
    updatePeerlyP2pJob.mockImplementation(async () => {
      await service.prisma.outreach.update({
        where: { id: row.id },
        data: { candidateEditClaimedAt: addDays(new Date(), 1) },
      })
    })

    const res = await editScript(row.id)

    expect(res.status).toBe(HttpStatus.CONFLICT)
    expect((await readRow(row.id)).script).toBe(OLD_SCRIPT)
  })
})

describe('approve while the candidate is editing', () => {
  it('refuses while the edit claim is fresh', async () => {
    const row = await seedOutreach({
      candidateEditClaimedAt: subMinutes(new Date(), 1),
    })

    const res = await approve(row.id)

    expect(res.status).toBe(HttpStatus.CONFLICT)
    expect(res.data.message).toBe(
      'The candidate is editing this text, refresh in a moment.',
    )
    expect(requestCanvassers).not.toHaveBeenCalled()
    expect((await readRow(row.id)).approvedAt).toBeNull()
  })

  it('approves once the claim is older than 10 minutes', async () => {
    const row = await seedOutreach({
      candidateEditClaimedAt: subMinutes(new Date(), 11),
    })

    const res = await approve(row.id)

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(requestCanvassers).toHaveBeenCalled()
    expect((await readRow(row.id)).approvedAt).not.toBeNull()
  })
})
