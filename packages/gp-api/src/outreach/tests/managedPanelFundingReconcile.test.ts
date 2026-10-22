import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from 'vitest'
import {
  OutreachFunding,
  OutreachStatus,
  OutreachType,
  PollAudienceKind,
  Prisma,
} from '@/generated/prisma'
import { useTestService } from '@/test-service'
import { SlackService } from '@/vendors/slack/services/slack.service'
import { ManagedPanelFundingReconcileService } from '../services/managedPanelFundingReconcile.service'

const service = useTestService()

let slug: string
let slackMessage: Mock<SlackService['message']>

const reconciler = () => service.app.get(ManagedPanelFundingReconcileService)

beforeEach(async () => {
  slug = `eo-recon-${Date.now()}-${Math.random().toString(36).slice(2)}`
  await service.prisma.organization.create({
    data: { slug, ownerId: service.user.id },
  })
  slackMessage = vi.fn<SlackService['message']>().mockResolvedValue(undefined)
  vi.spyOn(service.app.get(SlackService), 'message').mockImplementation(
    slackMessage,
  )
})

afterEach(() => {
  vi.unstubAllEnvs()
})

const send = (data: Partial<Prisma.OutreachUncheckedCreateInput> = {}) =>
  service.prisma.outreach.create({
    data: {
      organizationSlug: slug,
      campaignId: null,
      outreachType: OutreachType.text,
      status: OutreachStatus.in_progress,
      textCount: 50,
      ...data,
    },
  })

const freeWave = async (organizationSlug = slug) => {
  const enrollment = await service.prisma.managedCivicPanel.create({
    data: {
      organizationSlug,
      inviteMessage: 'Join my civic panel.',
      consentVersion: 'v1',
      approvedAt: new Date(),
      approvedByUserId: service.user.id,
      goalMembers: 100,
    },
  })
  const wave = await service.prisma.managedPanelWave.create({
    data: { enrollmentId: enrollment.id, wave: 1 },
  })
  return send({
    fundedBy: OutreachFunding.goodparty_pilot,
    managedPanelWaveId: wave.id,
  })
}

describe('ManagedPanelFundingReconcileService.reconcile', () => {
  it('is quiet when every send is paid or a valid managed wave', async () => {
    await send({ stripeCheckoutSessionId: 'cs_test_paid' })
    await send({
      outreachType: OutreachType.poll,
      status: OutreachStatus.pending,
      stripeCheckoutSessionId: 'cs_test_poll',
    })
    await freeWave()
    // Unpaid drafts and canceled drafts never moved past checkout.
    await send({ status: OutreachStatus.pending_payment })
    await send({ status: OutreachStatus.canceled })

    expect(await reconciler().reconcile()).toEqual([])
    expect(slackMessage).not.toHaveBeenCalled()
  })

  it('flags a Serve text past checkout with no funding', async () => {
    const unpaid = await send()

    const mismatches = await reconciler().reconcile()

    expect(mismatches).toEqual([
      {
        outreachId: unpaid.id,
        sendSeq: 1,
        organizationSlug: slug,
        status: OutreachStatus.in_progress,
      },
    ])
    expect(slackMessage).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(slackMessage.mock.calls[0]?.[0])).toContain(
      `Outreach ${unpaid.id}`,
    )
  })

  it('flags a pilot send whose wave belongs to another office', async () => {
    const otherSlug = `${slug}-other`
    await service.prisma.organization.create({
      data: { slug: otherSlug, ownerId: service.user.id },
    })
    const row = await freeWave(otherSlug)

    const mismatches = await reconciler().reconcile()

    expect(mismatches.map((m) => m.outreachId)).toEqual([row.id])
  })

  it('flags an expansion past checkout with no session', async () => {
    const poll = await send({
      outreachType: OutreachType.poll,
      status: OutreachStatus.completed,
      stripeCheckoutSessionId: 'cs_test_poll',
    })
    await service.prisma.outreachPoll.create({
      data: {
        outreachId: poll.id,
        topic: 'roads',
        audienceKind: PollAudienceKind.list,
        biasOverridden: false,
      },
    })
    await service.prisma.outreachPollExpansion.create({
      data: {
        outreachId: poll.id,
        sendSeq: 2,
        textCount: 10,
        status: OutreachStatus.in_progress,
        approvedAt: new Date(),
      },
    })

    const mismatches = await reconciler().reconcile()

    expect(mismatches).toEqual([
      expect.objectContaining({ outreachId: poll.id, sendSeq: 2 }),
    ])
  })

  it('looks back one day only', async () => {
    const old = await send()
    await service.prisma
      .$executeRaw`UPDATE outreach SET "updatedAt" = now() - interval '2 days' WHERE id = ${old.id}`

    expect(await reconciler().reconcile()).toEqual([])
  })

  it('leaves Win sends to their own checks', async () => {
    await service.prisma.campaign.create({
      data: { slug, organizationSlug: slug, userId: service.user.id },
    })
    const campaign = await service.prisma.campaign.findFirstOrThrow({
      where: { slug },
    })
    await send({ campaignId: campaign.id })

    expect(await reconciler().reconcile()).toEqual([])
  })
})

describe('ManagedPanelFundingReconcileService.reconcileDaily', () => {
  it('runs once per day across replicas', async () => {
    vi.stubEnv('OTEL_SERVICE_ENVIRONMENT', 'prod')
    const reconcile = vi.spyOn(reconciler(), 'reconcile').mockResolvedValue([])

    await Promise.all([
      reconciler().reconcileDaily(),
      reconciler().reconcileDaily(),
    ])

    expect(reconcile).toHaveBeenCalledTimes(1)
  })

  it('does not run on a preview stack', async () => {
    vi.stubEnv('OTEL_SERVICE_ENVIRONMENT', 'preview')
    const reconcile = vi.spyOn(reconciler(), 'reconcile').mockResolvedValue([])

    await reconciler().reconcileDaily()

    expect(reconcile).not.toHaveBeenCalled()
  })
})
