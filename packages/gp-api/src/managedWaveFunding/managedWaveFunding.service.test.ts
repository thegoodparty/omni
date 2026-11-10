import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { FeaturesService } from '@/features/services/features.service'
import {
  ManagedCivicPanelStatus,
  OutreachFunding,
  OutreachStatus,
  OutreachType,
  Prisma,
} from '@/generated/prisma'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { ContactsService } from '@/contacts/services/contacts.service'
import { JobsService } from '@/jobs/jobs.service'
import {
  TEXT_DELIVERY_HANDOFF_PORT,
  type TextDeliveryHandoff,
  type TextDeliveryHandoffPort,
} from '@/outreach/interfaces/textDeliveryHandoff.interface'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { useTestService } from '@/test-service'
import { SlackService } from '@/vendors/slack/services/slack.service'
import { ManagedWaveFundingService } from './managedWaveFunding.service'

// Waves and their sends are created directly: nothing in the app makes one
// yet. Every refusal must leave the send an unfunded draft with nothing
// enqueued and no free texts spent. Workers on for the test that lets a
// claimed wave's outreachTextSend job run; the rest stub the send.
const service = useTestService({ jobs: true })

const INVITE =
  'This is your council member. Join my civic panel: reply JOIN. ' +
  'Reply STOP to opt out.'
const TEXT_COUNT = 400

let slug: string
let enrollmentId: string
let nextWave: number
let isFeatureEnabled: Mock<FeaturesService['isFeatureEnabled']>
let sendMany: Mock<JobsService['sendMany']>
let slackMessage: Mock<SlackService['message']>

const funding = () => service.app.get(ManagedWaveFundingService)

beforeEach(async () => {
  slug = `eo-free-${Date.now()}-${Math.random().toString(36).slice(2)}`
  await service.prisma.organization.create({
    data: { slug, ownerId: service.user.id },
  })
  enrollmentId = (
    await service.prisma.managedCivicPanel.create({
      data: {
        organizationSlug: slug,
        inviteMessage: INVITE,
        consentVersion: 'v1',
        approvedAt: new Date(),
        approvedByUserId: service.user.id,
        goalMembers: 200,
      },
    })
  ).id
  nextWave = 1

  isFeatureEnabled = vi
    .fn<FeaturesService['isFeatureEnabled']>()
    .mockResolvedValue(true)
  vi.spyOn(
    service.app.get(FeaturesService),
    'isFeatureEnabled',
  ).mockImplementation(isFeatureEnabled)
  sendMany = vi.fn<JobsService['sendMany']>().mockResolvedValue([])
  vi.spyOn(service.app.get(JobsService), 'sendMany').mockImplementation(
    sendMany,
  )
  slackMessage = vi.fn<SlackService['message']>().mockResolvedValue(undefined)
  vi.spyOn(service.app.get(SlackService), 'message').mockImplementation(
    slackMessage,
  )
  vi.spyOn(
    service.app.get(OrganizationsService),
    'resolvePositionNameByOrganizationSlug',
  ).mockResolvedValue('City Council')
})

const wave = async (
  outreach: Partial<Prisma.OutreachUncheckedCreateInput> | null = {},
) => {
  const row = await service.prisma.managedPanelWave.create({
    data: { enrollmentId, wave: nextWave++ },
  })
  const send =
    outreach === null
      ? null
      : await service.prisma.outreach.create({
          data: {
            organizationSlug: slug,
            campaignId: null,
            outreachType: OutreachType.text,
            status: OutreachStatus.pending_payment,
            message: INVITE,
            scheduledLocalDate: '2026-11-05',
            textCount: TEXT_COUNT,
            managedPanelWaveId: row.id,
            ...outreach,
          },
        })
  return { waveId: row.id, outreachId: send?.id }
}

const panel = () =>
  service.prisma.managedCivicPanel.findUniqueOrThrow({
    where: { id: enrollmentId },
  })

const setPanel = (data: Prisma.ManagedCivicPanelUpdateInput) =>
  service.prisma.managedCivicPanel.update({
    where: { id: enrollmentId },
    data,
  })

const expectUntouched = async (
  outreachId: number | undefined,
  status: OutreachStatus = OutreachStatus.pending_payment,
  freeTextsUsed = 0,
) => {
  if (outreachId !== undefined) {
    expect(
      await service.prisma.outreach.findUniqueOrThrow({
        where: { id: outreachId },
      }),
    ).toMatchObject({ status, fundedBy: null, billableTextCount: null })
  }
  expect(sendMany).not.toHaveBeenCalled()
  expect((await panel()).freeTextsUsed).toBe(freeTextsUsed)
}

const pauseAtCap = (waveId: string): Promise<void> =>
  Reflect.apply(Reflect.get(funding(), 'pauseAtCap'), funding(), [waveId])

const revert = (
  waveId: string,
  outreachId: number,
  textCount: number,
): Promise<void> =>
  Reflect.apply(Reflect.get(funding(), 'revert'), funding(), [
    waveId,
    outreachId,
    textCount,
  ])

describe('ManagedWaveFundingService.claimFree', () => {
  it('claims a building, approved wave free and enqueues its send', async () => {
    const { waveId, outreachId } = await wave()

    const result = await funding().claimFree(waveId)

    expect(result).toEqual({
      claimed: true,
      outreachId,
      organizationSlug: slug,
      textCount: TEXT_COUNT,
      resumed: false,
    })
    expect(
      await service.prisma.outreach.findUniqueOrThrow({
        where: { id: outreachId },
      }),
    ).toMatchObject({
      status: OutreachStatus.pending,
      fundedBy: OutreachFunding.goodparty_pilot,
      billableTextCount: TEXT_COUNT,
      stripeCheckoutSessionId: null,
    })
    expect((await panel()).freeTextsUsed).toBe(TEXT_COUNT)
    expect(sendMany).toHaveBeenCalledWith('outreachTextSend', [
      {
        data: { outreachId, sendSeq: 1 },
        key: `${outreachId}:1`,
        group: String(outreachId),
      },
    ])
    expect(isFeatureEnabled).toHaveBeenCalledWith({
      user: service.user.id,
      feature: 'serve-citizen-panels',
    })
    const notice = JSON.stringify(slackMessage.mock.calls[0]?.[0])
    expect(notice).toContain('pilot wave')
    expect(notice).toContain('City Council')
    expect(slackMessage.mock.calls[0]?.[1]).toBe('bot-tevyn-api')
  })

  it('refuses without the serve-citizen-panels flag', async () => {
    isFeatureEnabled.mockResolvedValue(false)
    const { waveId, outreachId } = await wave()

    expect(await funding().claimFree(waveId)).toEqual({
      claimed: false,
      reason: 'flag_off',
    })
    await expectUntouched(outreachId)
  })

  it('refuses once the flag is turned off mid-build', async () => {
    const first = await wave()
    expect((await funding().claimFree(first.waveId)).claimed).toBe(true)
    sendMany.mockClear()
    isFeatureEnabled.mockResolvedValue(false)
    const second = await wave()

    expect(await funding().claimFree(second.waveId)).toEqual({
      claimed: false,
      reason: 'flag_off',
    })
    await expectUntouched(second.outreachId, undefined, TEXT_COUNT)
  })

  it('refuses a paused panel', async () => {
    await setPanel({
      status: ManagedCivicPanelStatus.paused,
      pausedAt: new Date(),
    })
    const { waveId, outreachId } = await wave()

    expect(await funding().claimFree(waveId)).toEqual({
      claimed: false,
      reason: 'not_building',
    })
    await expectUntouched(outreachId)
  })

  it('refuses a stopped panel', async () => {
    await setPanel({
      status: ManagedCivicPanelStatus.stopped,
      stoppedAt: new Date(),
    })
    const { waveId, outreachId } = await wave()

    expect(await funding().claimFree(waveId)).toEqual({
      claimed: false,
      reason: 'not_building',
    })
    await expectUntouched(outreachId)
  })

  it('refuses a panel with no approver on record', async () => {
    await setPanel({ approvedBy: { disconnect: true } })
    const { waveId, outreachId } = await wave()

    expect(await funding().claimFree(waveId)).toEqual({
      claimed: false,
      reason: 'not_approved',
    })
    expect(isFeatureEnabled).not.toHaveBeenCalled()
    await expectUntouched(outreachId)
  })

  it('refuses a send in another organization', async () => {
    const otherSlug = `${slug}-other`
    await service.prisma.organization.create({
      data: { slug: otherSlug, ownerId: service.user.id },
    })
    const { waveId, outreachId } = await wave({ organizationSlug: otherSlug })

    expect(await funding().claimFree(waveId)).toEqual({
      claimed: false,
      reason: 'wrong_org',
    })
    await expectUntouched(outreachId)
  })

  it('refuses a wave over the free text cap, and pauses the panel', async () => {
    await setPanel({ freeTextsUsed: 15_000 - TEXT_COUNT + 1 })
    const { waveId, outreachId } = await wave()

    expect(await funding().claimFree(waveId)).toEqual({
      claimed: false,
      reason: 'over_cap',
    })
    await expectUntouched(outreachId, undefined, 15_000 - TEXT_COUNT + 1)
    expect((await panel()).status).toBe(ManagedCivicPanelStatus.paused)
    expect(JSON.stringify(slackMessage.mock.calls[0]?.[0])).toContain(
      'paused at its free text cap',
    )
  })

  it('claims a wave that exactly fills the cap', async () => {
    await setPanel({ freeTextsUsed: 15_000 - TEXT_COUNT })
    const { waveId } = await wave()

    expect((await funding().claimFree(waveId)).claimed).toBe(true)
    expect((await panel()).freeTextsUsed).toBe(15_000)
  })

  it('refuses a send that already has a checkout session', async () => {
    const { waveId, outreachId } = await wave({
      stripeCheckoutSessionId: 'cs_test_paid',
    })

    expect(await funding().claimFree(waveId)).toEqual({
      claimed: false,
      reason: 'has_checkout_session',
    })
    await expectUntouched(outreachId)
  })

  it('refuses a send that is not awaiting payment', async () => {
    const { waveId, outreachId } = await wave({
      status: OutreachStatus.pending,
    })

    expect(await funding().claimFree(waveId)).toEqual({
      claimed: false,
      reason: 'not_pending_payment',
    })
    await expectUntouched(outreachId, OutreachStatus.pending)
  })

  it('refuses a wave with no send linked to it', async () => {
    const { waveId } = await wave(null)
    const unlinked = await service.prisma.outreach.create({
      data: {
        organizationSlug: slug,
        outreachType: OutreachType.text,
        status: OutreachStatus.pending_payment,
        message: INVITE,
        textCount: TEXT_COUNT,
      },
    })

    expect(await funding().claimFree(waveId)).toEqual({
      claimed: false,
      reason: 'no_outreach',
    })
    await expectUntouched(unlinked.id)
  })

  it('reads the flag for the approving official, not anyone else', async () => {
    const approver = await service.prisma.user.create({
      data: {
        email: `approver-${slug}@goodparty.org`,
        clerkId: `user_${slug}`,
      },
    })
    await setPanel({ approvedBy: { connect: { id: approver.id } } })
    isFeatureEnabled.mockImplementation(({ user }) =>
      Promise.resolve(user === service.user.id),
    )
    const { waveId, outreachId } = await wave()

    expect(await funding().claimFree(waveId)).toEqual({
      claimed: false,
      reason: 'flag_off',
    })
    expect(isFeatureEnabled).toHaveBeenCalledWith({
      user: approver.id,
      feature: 'serve-citizen-panels',
    })
    await expectUntouched(outreachId)
  })

  it('refuses words the official did not approve', async () => {
    const { waveId, outreachId } = await wave({
      message: 'Vote for me on Tuesday. Reply STOP to opt out.',
    })

    expect(await funding().claimFree(waveId)).toEqual({
      claimed: false,
      reason: 'not_the_approved_invite',
    })
    await expectUntouched(outreachId)
  })

  it('refuses a poll', async () => {
    const { waveId, outreachId } = await wave({
      outreachType: OutreachType.poll,
    })

    expect(await funding().claimFree(waveId)).toEqual({
      claimed: false,
      reason: 'not_serve_text',
    })
    await expectUntouched(outreachId)
  })

  it('refuses a wave id that does not exist', async () => {
    expect(
      await funding().claimFree('01900000-0000-7000-8000-000000000000'),
    ).toEqual({ claimed: false, reason: 'wave_not_found' })
  })

  it('re-enqueues its own stranded claim without counting it twice', async () => {
    const { waveId, outreachId } = await wave()
    expect((await funding().claimFree(waveId)).claimed).toBe(true)
    // As if the process died after the claim committed, before the enqueue.
    sendMany.mockClear()

    expect(await funding().claimFree(waveId)).toEqual({
      claimed: true,
      outreachId,
      organizationSlug: slug,
      textCount: TEXT_COUNT,
      resumed: true,
    })
    expect(sendMany).toHaveBeenCalledWith('outreachTextSend', [
      expect.objectContaining({
        key: `${outreachId}:1`,
        group: String(outreachId),
      }),
    ])
    expect((await panel()).freeTextsUsed).toBe(TEXT_COUNT)
  })

  it('keeps a resumed claim when its enqueue fails again', async () => {
    const { waveId, outreachId } = await wave()
    expect((await funding().claimFree(waveId)).claimed).toBe(true)
    sendMany.mockRejectedValue(new Error('queue down'))

    await expect(funding().claimFree(waveId)).rejects.toThrow('queue down')

    expect(
      await service.prisma.outreach.findUniqueOrThrow({
        where: { id: outreachId },
      }),
    ).toMatchObject({
      status: OutreachStatus.pending,
      fundedBy: OutreachFunding.goodparty_pilot,
    })
    expect((await panel()).freeTextsUsed).toBe(TEXT_COUNT)
  })

  it('does not resume a claim once its official leaves the flag', async () => {
    const { waveId } = await wave()
    expect((await funding().claimFree(waveId)).claimed).toBe(true)
    sendMany.mockClear()
    isFeatureEnabled.mockResolvedValue(false)

    expect(await funding().claimFree(waveId)).toEqual({
      claimed: false,
      reason: 'flag_off',
    })
    expect(sendMany).not.toHaveBeenCalled()
  })

  it('does not resume a claim once the panel is paused', async () => {
    const { waveId } = await wave()
    expect((await funding().claimFree(waveId)).claimed).toBe(true)
    sendMany.mockClear()
    await setPanel({
      status: ManagedCivicPanelStatus.paused,
      pausedAt: new Date(),
    })

    expect(await funding().claimFree(waveId)).toEqual({
      claimed: false,
      reason: 'not_pending_payment',
    })
    expect(sendMany).not.toHaveBeenCalled()
  })

  it('does not resume a send that has moved past pending', async () => {
    const { waveId, outreachId } = await wave()
    expect((await funding().claimFree(waveId)).claimed).toBe(true)
    await service.prisma.outreach.update({
      where: { id: outreachId },
      data: { status: OutreachStatus.in_progress },
    })
    sendMany.mockClear()

    expect(await funding().claimFree(waveId)).toEqual({
      claimed: false,
      reason: 'not_pending_payment',
    })
    expect(sendMany).not.toHaveBeenCalled()
  })

  it('lets only one of two racing waves take the last of the cap', async () => {
    await setPanel({ freeTextsUsed: 15_000 - TEXT_COUNT })
    const first = await wave()
    const second = await wave()

    const results = await Promise.all([
      funding().claimFree(first.waveId),
      funding().claimFree(second.waveId),
    ])

    expect(results.filter((r) => r.claimed)).toHaveLength(1)
    expect((await panel()).freeTextsUsed).toBe(15_000)
    expect(sendMany).toHaveBeenCalledTimes(1)
  })

  it('reverts the claim when the send cannot be enqueued', async () => {
    sendMany.mockRejectedValue(new Error('queue down'))
    const { waveId, outreachId } = await wave()

    await expect(funding().claimFree(waveId)).rejects.toThrow('queue down')

    expect(
      await service.prisma.outreach.findUniqueOrThrow({
        where: { id: outreachId },
      }),
    ).toMatchObject({
      status: OutreachStatus.pending_payment,
      fundedBy: null,
      billableTextCount: null,
    })
    expect((await panel()).freeTextsUsed).toBe(0)
    expect(slackMessage).not.toHaveBeenCalled()
  })
})

// A claimed wave's outreachTextSend job run for real, with only S3, people
// data and the fulfilment handoff stubbed: the wave job is the only way in,
// and no Playwright spec reaches it.
describe('a claimed wave is sent', () => {
  let handoffs: TextDeliveryHandoff[]

  beforeEach(() => {
    vi.mocked(service.app.get(JobsService).sendMany).mockRestore()
    vi.stubEnv('OUTREACH_TEXT_CSVS_BUCKET', 'managed-wave-csvs')
    handoffs = []
    const port: TextDeliveryHandoffPort = service.app.get(
      TEXT_DELIVERY_HANDOFF_PORT,
    )
    vi.spyOn(port, 'send').mockImplementation(async (handoff) => {
      handoffs.push(handoff)
    })
    const objects = new Map<string, string>()
    const s3 = service.app.get(S3Service)
    vi.spyOn(s3, 'getFile').mockImplementation(async (bucket, key) =>
      objects.get(`${bucket}/${key}`),
    )
    vi.spyOn(s3, 'uploadFile').mockImplementation(async (bucket, body, key) => {
      objects.set(`${bucket}/${key}`, body as string)
      return `https://${bucket}/${key}`
    })
    vi.spyOn(
      service.app.get(ContactsService),
      'findContactsForFilter',
    ).mockResolvedValue({
      people: [
        {
          id: 'p-1',
          firstName: 'Jane',
          lastName: 'Doe',
          cellPhone: '5551230001',
        },
        {
          id: 'p-2',
          firstName: 'Joe',
          lastName: 'Roe',
          cellPhone: '5551230002',
        },
      ],
      pagination: { totalResults: 2 },
    } as never)
  })

  it('hands the wave to fulfilment with the agent hand-off it was claimed with', async () => {
    const list = await service.prisma.voterFileFilter.create({
      data: { organizationSlug: slug, name: 'Wave 1' },
    })
    const { waveId, outreachId } = await wave({ voterFileFilterId: list.id })
    const sendAt = new Date('2026-11-05T19:00:00.000Z')

    expect(
      (
        await funding().claimFree(waveId, {
          mode: 'shadow',
          sendAt,
          timeZone: 'US/Pacific',
        })
      ).claimed,
    ).toBe(true)
    await service.jobs.settle()

    expect(
      (
        await service.prisma.outreach.findUniqueOrThrow({
          where: { id: outreachId },
        })
      ).status,
    ).toBe(OutreachStatus.in_progress)
    expect(handoffs).toEqual([
      expect.objectContaining({
        outreachId: String(outreachId),
        recipientCount: 2,
        agentHandoff: { mode: 'shadow', sendAt, timeZone: 'US/Pacific' },
      }),
    ])
    expect(
      await service.prisma.outreachTextHandoff.findUniqueOrThrow({
        where: { outreachId },
      }),
    ).toMatchObject({ mode: 'shadow', sendAt, timeZone: 'US/Pacific' })
  })
})

describe('pausing at the cap', () => {
  it('does not pause when a reverted sibling has left room', async () => {
    const { waveId } = await wave()

    await pauseAtCap(waveId)

    expect((await panel()).status).toBe(ManagedCivicPanelStatus.building)
    expect(slackMessage).not.toHaveBeenCalled()
  })

  it('pauses when the wave still does not fit', async () => {
    await setPanel({ freeTextsUsed: 15_000 })
    const { waveId } = await wave()

    await pauseAtCap(waveId)

    expect((await panel()).status).toBe(ManagedCivicPanelStatus.paused)
  })
})

describe('reverting a claim', () => {
  it('waits for the enrollment lock before touching either row', async () => {
    const { waveId, outreachId } = await wave()
    expect((await funding().claimFree(waveId)).claimed).toBe(true)

    let reverting: Promise<void> | undefined
    await service.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM managed_civic_panel WHERE id = ${enrollmentId} FOR UPDATE`
      reverting = revert(waveId, outreachId ?? 0, TEXT_COUNT)
      await new Promise((resolve) => setTimeout(resolve, 300))
      // Still blocked: a claim holding this lock sees the claim whole.
      expect(
        (
          await service.prisma.outreach.findUniqueOrThrow({
            where: { id: outreachId },
          })
        ).status,
      ).toBe(OutreachStatus.pending)
    })
    await reverting

    expect(
      await service.prisma.outreach.findUniqueOrThrow({
        where: { id: outreachId },
      }),
    ).toMatchObject({ status: OutreachStatus.pending_payment, fundedBy: null })
    expect((await panel()).freeTextsUsed).toBe(0)
  })
})

describe('claimConfirmationFree', () => {
  const THANKS =
    "Hi, this is Jordan Rivera, your Mayor. Thank you for joining the group of Asheville residents I'm inviting to share their views.\nReply STOP to opt out."

  const confirmation = (
    outreach: Partial<Prisma.OutreachUncheckedCreateInput> = {},
  ) =>
    service.prisma.outreach.create({
      data: {
        organizationSlug: slug,
        campaignId: null,
        outreachType: OutreachType.text,
        status: OutreachStatus.pending_payment,
        message: THANKS,
        scheduledLocalDate: '2026-11-05',
        textCount: 120,
        managedPanelConfirmationForId: enrollmentId,
        ...outreach,
      },
    })

  beforeEach(async () => {
    await setPanel({
      status: ManagedCivicPanelStatus.ready,
      readyAt: new Date(),
      freeTextsUsed: 15000,
    })
  })

  it('claims a ready panel’s confirmation free, outside the free-text cap', async () => {
    const send = await confirmation()

    const result = await funding().claimConfirmationFree(enrollmentId)

    expect(result).toMatchObject({ claimed: true, outreachId: send.id })
    expect(
      await service.prisma.outreach.findUniqueOrThrow({
        where: { id: send.id },
      }),
    ).toMatchObject({
      status: OutreachStatus.pending,
      fundedBy: OutreachFunding.goodparty_panel_confirmation,
      billableTextCount: 120,
    })
    expect((await panel()).freeTextsUsed).toBe(15000)
    expect(sendMany).toHaveBeenCalledTimes(1)
    expect(sendMany).toHaveBeenCalledWith('outreachTextSend', [
      {
        data: { outreachId: send.id, sendSeq: 1 },
        key: `${send.id}:1`,
        group: String(send.id),
      },
    ])
  })

  it('refuses before the panel is ready', async () => {
    await setPanel({ status: ManagedCivicPanelStatus.building })
    const send = await confirmation()

    expect(await funding().claimConfirmationFree(enrollmentId)).toEqual({
      claimed: false,
      reason: 'not_ready',
    })
    await expectUntouched(send.id, OutreachStatus.pending_payment, 15000)
  })

  it('refuses a text that asks anyone to join or has no opt-out', async () => {
    const send = await confirmation({
      message: 'Thanks! Reply JOIN to share your perspectives.',
    })

    expect(await funding().claimConfirmationFree(enrollmentId)).toEqual({
      claimed: false,
      reason: 'not_a_confirmation',
    })
    await expectUntouched(send.id, OutreachStatus.pending_payment, 15000)
  })

  it('refuses with the flag off for the approver', async () => {
    isFeatureEnabled.mockResolvedValue(false)
    const send = await confirmation()

    expect(await funding().claimConfirmationFree(enrollmentId)).toEqual({
      claimed: false,
      reason: 'flag_off',
    })
    await expectUntouched(send.id, OutreachStatus.pending_payment, 15000)
  })

  it('hands a claim back when its enqueue fails', async () => {
    const send = await confirmation()
    sendMany.mockRejectedValueOnce(new Error('queue down'))

    await expect(funding().claimConfirmationFree(enrollmentId)).rejects.toThrow(
      'queue down',
    )

    expect(
      await service.prisma.outreach.findUniqueOrThrow({
        where: { id: send.id },
      }),
    ).toMatchObject({
      status: OutreachStatus.pending_payment,
      fundedBy: null,
      billableTextCount: null,
    })
  })
})
