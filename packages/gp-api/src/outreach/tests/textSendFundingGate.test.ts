import type { PeopleListResponse, Person } from '@goodparty_org/contracts'
import { PinoLogger } from 'nestjs-pino'
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { ContactInteractionTextService } from '@/contactInteraction/services/contactInteractionText.service'
import { ContactsService } from '@/contacts/services/contacts.service'
import {
  ManagedCivicPanelStatus,
  OutreachFunding,
  OutreachStatus,
  OutreachType,
  PollAudienceKind,
  Prisma,
} from '@/generated/prisma'
import { QueueProducerService } from '@/queue/producer/queueProducer.service'
import { useTestService } from '@/test-service'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { SlackService } from '@/vendors/slack/services/slack.service'
import { VoterFileFilterService } from '@/voters/services/voterFileFilter.service'
import { OutreachPollAdminService } from '../services/outreachPollAdmin.service'
import { OutreachServeSmsPurchaseHandlerService } from '../services/outreachServeSmsPurchase.service'
import { OutreachTextDeliveryService } from '../services/outreachTextDelivery.service'
import { OutreachTextSendFundingService } from '../services/outreachTextSendFunding.service'
import { FeaturesService } from '@/features/services/features.service'
import { ManagedWaveFundingService } from '@/managedWaveFunding/managedWaveFunding.service'

// The second gate on free sends: the delivery layer hands a send to a human
// only when it was paid at checkout or is a live managed civic panel wave.
// Every paid path below is produced by the real purchase handler, so these
// tests fail if a paid path ever stops leaving the proof the gate reads.
const service = useTestService()

const INVITE = 'Join my civic panel. Reply JOIN. Reply STOP to opt out.'
const BUCKET = 'text-delivery-csvs'

const person = (id: string, cellPhone: string): Person =>
  ({ id, firstName: 'Jane', lastName: 'Doe', cellPhone }) as Person

const peoplePage = (people: Person[]) =>
  ({
    people,
    pagination: { totalResults: people.length },
  }) as unknown as PeopleListResponse

let slug: string
let filterId: number
let delivery: OutreachTextDeliveryService
let handoffs: number
let isFeatureEnabled: Mock<FeaturesService['isFeatureEnabled']>
let slackMessage: Mock<SlackService['message']>

beforeEach(async () => {
  isFeatureEnabled = vi
    .fn<FeaturesService['isFeatureEnabled']>()
    .mockResolvedValue(true)
  vi.spyOn(
    service.app.get(FeaturesService),
    'isFeatureEnabled',
  ).mockImplementation(isFeatureEnabled)
  vi.stubEnv('OUTREACH_TEXT_CSVS_BUCKET', BUCKET)
  slug = `eo-gate-${Date.now()}-${Math.random().toString(36).slice(2)}`
  await service.prisma.organization.create({
    data: { slug, ownerId: service.user.id },
  })
  filterId = (
    await service.prisma.voterFileFilter.create({
      data: { organizationSlug: slug, name: 'constituents' },
    })
  ).id

  const objects = new Map<string, string>()
  const s3 = {
    getFile: vi.fn((bucket: string, key: string) =>
      Promise.resolve(objects.get(`${bucket}/${key}`)),
    ),
    uploadFile: vi.fn((bucket: string, body: string, key: string) => {
      objects.set(`${bucket}/${key}`, body)
      return Promise.resolve(`https://${bucket}/${key}`)
    }),
  }
  handoffs = 0
  slackMessage = vi.fn<SlackService['message']>().mockResolvedValue(undefined)
  vi.spyOn(service.app.get(SlackService), 'message').mockImplementation(
    slackMessage,
  )
  vi.spyOn(
    service.app.get(QueueProducerService),
    'sendMessage',
  ).mockResolvedValue(undefined)
  vi.spyOn(
    service.app.get(ContactsService),
    'findContactsForFilter',
  ).mockResolvedValue(
    peoplePage([person('p-1', '5551230001'), person('p-2', '5551230002')]),
  )

  delivery = new OutreachTextDeliveryService(
    service.app.get(ContactsService),
    service.app.get(VoterFileFilterService),
    service.app.get(ContactInteractionTextService),
    s3 as unknown as S3Service,
    {
      send: () => {
        handoffs++
        return Promise.resolve()
      },
    },
    service.app.get(OutreachTextSendFundingService),
  )
  Reflect.set(delivery, '_prisma', service.prisma)
  Reflect.set(delivery, 'logger', {
    setContext: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as PinoLogger)
  delivery.onModuleInit()
})

const draft = (data: Partial<Prisma.OutreachUncheckedCreateInput> = {}) =>
  service.prisma.outreach.create({
    data: {
      organizationSlug: slug,
      campaignId: null,
      outreachType: OutreachType.text,
      status: OutreachStatus.pending_payment,
      message: 'The budget hearing is Thursday. Reply STOP to opt out.',
      scheduledLocalDate: '2026-11-05',
      voterFileFilterId: filterId,
      textCount: 2,
      ...data,
    },
  })

const pay = (outreachId: number, expansionId?: string) =>
  service.app
    .get(OutreachServeSmsPurchaseHandlerService)
    .executePostPurchase(`cs_test_${outreachId}_${expansionId ?? 'first'}`, {
      outreachId: String(outreachId),
      organizationSlug: slug,
      ...(expansionId ? { expansionId } : {}),
    })

const send = (outreachId: number, sendSeq = 1) =>
  delivery.requestSend({
    outreachId,
    sendSeq,
    audience: { kind: 'savedFilter', voterFileFilterId: filterId },
    message: 'A note from your council member.',
    scheduledLocalDate: '2026-11-05',
  })

const statusOf = async (id: number) =>
  (await service.prisma.outreach.findUniqueOrThrow({ where: { id } })).status

const enrollment = (
  data: Partial<Prisma.ManagedCivicPanelUncheckedCreateInput> = {},
) =>
  service.prisma.managedCivicPanel.create({
    data: {
      organizationSlug: slug,
      inviteMessage: INVITE,
      consentVersion: 'v1',
      approvedAt: new Date(),
      approvedByUserId: service.user.id,
      goalMembers: 100,
      ...data,
    },
  })

// A free wave in the state the claim leaves it: pending, funded by the pilot.
const freeWave = async (enrollmentId: string) => {
  const wave = await service.prisma.managedPanelWave.create({
    data: { enrollmentId, wave: 1, voterFileFilterId: filterId },
  })
  return draft({
    message: INVITE,
    status: OutreachStatus.pending,
    fundedBy: OutreachFunding.goodparty_pilot,
    managedPanelWaveId: wave.id,
    billableTextCount: 2,
  })
}

const expectRefused = async (
  outreachId: number,
  result: Awaited<ReturnType<typeof send>>,
  status: OutreachStatus = OutreachStatus.pending,
) => {
  expect(result.terminalReason).toBe('unfunded')
  expect(handoffs).toBe(0)
  expect(await statusOf(outreachId)).toBe(status)
  expect(
    await service.prisma.outreachTextRecipient.count({ where: { outreachId } }),
  ).toBe(0)
  expect(slackMessage).toHaveBeenCalledTimes(1)
  expect(JSON.stringify(slackMessage.mock.calls[0]?.[0])).toContain(
    'Unfunded text send refused',
  )
}

describe('every paid path still sends', () => {
  it('sends a Serve text paid at checkout', async () => {
    const row = await draft()
    await pay(row.id)

    const result = await send(row.id)

    expect(result.terminalReason).toBeUndefined()
    expect(result.recipientCount).toBe(2)
    expect(handoffs).toBe(1)
    expect(await statusOf(row.id)).toBe(OutreachStatus.in_progress)
  })

  it('sends a paid poll once staff approve it', async () => {
    const row = await draft({ outreachType: OutreachType.poll })
    await service.prisma.outreachPoll.create({
      data: {
        outreachId: row.id,
        topic: 'roads',
        audienceKind: PollAudienceKind.list,
        biasOverridden: false,
      },
    })
    await pay(row.id)
    await service.app
      .get(OutreachPollAdminService)
      .approve(row.id, { approvedBy: 'staff@goodparty.org' })

    const result = await send(row.id)

    expect(result.terminalReason).toBeUndefined()
    expect(handoffs).toBe(1)
  })

  it('sends a held round 2 text once its list is drawn', async () => {
    const first = await draft()
    const sample = await service.prisma.voterFileFilter.create({
      data: { organizationSlug: slug, name: 'follow-up', sampleSize: 2 },
    })
    const followUp = await draft({
      roundOneOutreachId: first.id,
      voterFileFilterId: sample.id,
    })
    await pay(first.id)
    expect(await statusOf(followUp.id)).toBe(OutreachStatus.pending)
    await service.prisma.voterFileFilter.update({
      where: { id: sample.id },
      data: { sampledAt: new Date() },
    })

    const result = await send(followUp.id)

    expect(result.terminalReason).toBeUndefined()
    expect(handoffs).toBe(1)
  })

  it('sends a paid poll expansion', async () => {
    const row = await draft({ outreachType: OutreachType.poll })
    await service.prisma.outreachPoll.create({
      data: {
        outreachId: row.id,
        topic: 'roads',
        audienceKind: PollAudienceKind.list,
        biasOverridden: false,
      },
    })
    await pay(row.id)
    await service.prisma.outreach.update({
      where: { id: row.id },
      data: { status: OutreachStatus.completed },
    })
    const expansion = await service.prisma.outreachPollExpansion.create({
      data: {
        outreachId: row.id,
        sendSeq: 2,
        textCount: 2,
        status: OutreachStatus.pending_payment,
      },
    })
    await pay(row.id, expansion.id)
    await service.prisma.outreachPollExpansion.update({
      where: { id: expansion.id },
      data: { approvedAt: new Date() },
    })

    const result = await send(row.id, 2)

    expect(result.terminalReason).toBeUndefined()
    expect(handoffs).toBe(1)
  })

  it('sends a live managed wave the pilot funds', async () => {
    const panel = await enrollment()
    const row = await freeWave(panel.id)

    const result = await send(row.id)

    expect(result.terminalReason).toBeUndefined()
    expect(handoffs).toBe(1)
  })
})

describe('refusals', () => {
  it('refuses a pending text nobody paid for', async () => {
    const row = await draft({ status: OutreachStatus.pending })

    await expectRefused(row.id, await send(row.id))
  })

  it('refuses an expansion nobody paid for', async () => {
    const row = await draft({
      outreachType: OutreachType.poll,
      status: OutreachStatus.completed,
      stripeCheckoutSessionId: 'cs_test_parent',
    })
    await service.prisma.outreachPoll.create({
      data: {
        outreachId: row.id,
        topic: 'roads',
        audienceKind: PollAudienceKind.list,
        biasOverridden: false,
      },
    })
    await service.prisma.outreachPollExpansion.create({
      data: {
        outreachId: row.id,
        sendSeq: 2,
        textCount: 2,
        status: OutreachStatus.pending,
        approvedAt: new Date(),
      },
    })

    const result = await send(row.id, 2)

    expect(result.terminalReason).toBe('unfunded')
    expect(handoffs).toBe(0)
  })

  it('cannot even store a pilot funding with no wave behind it', async () => {
    const row = await draft({ status: OutreachStatus.pending })

    await expect(
      service.prisma.outreach.update({
        where: { id: row.id },
        data: { fundedBy: OutreachFunding.goodparty_pilot },
      }),
    ).rejects.toThrow(/outreach_funded_by_needs_managed_wave/)
    await expectRefused(row.id, await send(row.id))
  })

  it('cannot store a pilot funding beside a checkout session', async () => {
    const panel = await enrollment()
    const row = await freeWave(panel.id)

    await expect(
      service.prisma.outreach.update({
        where: { id: row.id },
        data: { stripeCheckoutSessionId: 'cs_test_both' },
      }),
    ).rejects.toThrow(/outreach_funded_by_not_paid/)
  })

  it('refuses a pilot funding forced onto another office’s wave', async () => {
    const otherSlug = `${slug}-other`
    await service.prisma.organization.create({
      data: { slug: otherSlug, ownerId: service.user.id },
    })
    const panel = await enrollment({ organizationSlug: otherSlug })
    const row = await freeWave(panel.id)

    await expectRefused(row.id, await send(row.id))
  })

  it('refuses a free wave once the panel is stopped', async () => {
    const panel = await enrollment()
    const row = await freeWave(panel.id)
    await service.prisma.managedCivicPanel.update({
      where: { id: panel.id },
      data: {
        status: ManagedCivicPanelStatus.stopped,
        stoppedAt: new Date(),
      },
    })

    await expectRefused(row.id, await send(row.id))
  })

  it('refuses a free wave once its official is out of serve-citizen-panels', async () => {
    const panel = await enrollment()
    const row = await freeWave(panel.id)
    isFeatureEnabled.mockResolvedValue(false)

    await expectRefused(row.id, await send(row.id))
  })

  it('refuses a wave claimed in the flag after the flag is turned off', async () => {
    const panel = await enrollment()
    const wave = await service.prisma.managedPanelWave.create({
      data: { enrollmentId: panel.id, wave: 1, voterFileFilterId: filterId },
    })
    const row = await draft({ message: INVITE, managedPanelWaveId: wave.id })
    expect(
      (await service.app.get(ManagedWaveFundingService).claimFree(wave.id))
        .claimed,
    ).toBe(true)
    slackMessage.mockClear()
    isFeatureEnabled.mockResolvedValue(false)

    await expectRefused(row.id, await send(row.id))
  })

  it('refuses a send forced onto a wave with no pilot funding', async () => {
    const panel = await enrollment()
    const wave = await service.prisma.managedPanelWave.create({
      data: { enrollmentId: panel.id, wave: 1 },
    })
    const row = await draft({
      status: OutreachStatus.pending,
      managedPanelWaveId: wave.id,
    })

    await expectRefused(row.id, await send(row.id))
  })

  it('stays quiet about a send that is simply not pending', async () => {
    const row = await draft()

    const result = await send(row.id)

    expect(result.terminalReason).toBe('not_sendable')
    expect(slackMessage).not.toHaveBeenCalled()
  })
})
