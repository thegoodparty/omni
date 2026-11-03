import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import {
  OutreachHandoffHandler,
  OutreachHandoffStatus,
  OutreachStatus,
  OutreachType,
  Prisma,
} from '@/generated/prisma'
import { useTestService } from '@/test-service'
import { SlackService } from '@/vendors/slack/services/slack.service'
import { recordManagedPanelHandoffAlarm } from '../observability/managedPanelHandoff.metrics'
import { OutreachTextHandoffService } from '../services/outreachTextHandoff.service'

vi.mock('../observability/managedPanelHandoff.metrics', () => ({
  recordManagedPanelHandoffAlarm: vi.fn(),
}))

const service = useTestService()

let slug: string
let slackMessage: Mock<SlackService['message']>

const handoffs = () => service.app.get(OutreachTextHandoffService)

// 11am in Los Angeles, which is 19:00 UTC: a UTC-based cut-off or rendering
// would be off by the zone's offset.
const SEND_AT = new Date('2026-11-10T19:00:00Z')
const TIME_ZONE = 'America/Los_Angeles'
const minutesBefore = (minutes: number) =>
  new Date(SEND_AT.getTime() - minutes * 60_000)

beforeEach(async () => {
  slug = `eo-handoff-${Date.now()}-${Math.random().toString(36).slice(2)}`
  await service.prisma.organization.create({
    data: { slug, ownerId: service.user.id },
  })
  slackMessage = vi.fn<SlackService['message']>().mockResolvedValue(undefined)
  vi.spyOn(service.app.get(SlackService), 'message').mockImplementation(
    slackMessage,
  )
})

const handoff = async (
  data: Partial<Prisma.OutreachTextHandoffUncheckedCreateInput> = {},
) => {
  const outreach = await service.prisma.outreach.create({
    data: {
      organizationSlug: slug,
      campaignId: null,
      outreachType: OutreachType.text,
      status: OutreachStatus.pending,
      textCount: 50,
    },
  })
  const row = await service.prisma.outreachTextHandoff.create({
    data: {
      outreachId: outreach.id,
      handler: OutreachHandoffHandler.agent,
      mode: 'auto',
      sendAt: SEND_AT,
      timeZone: TIME_ZONE,
      ...data,
    },
  })
  return { outreach, row }
}

const reload = (id: string) =>
  service.prisma.outreachTextHandoff.findUniqueOrThrow({ where: { id } })

describe('OutreachTextHandoffService.markOverdue', () => {
  it('flags a queued row 59 minutes out and posts once', async () => {
    const { outreach, row } = await handoff()
    const now = minutesBefore(59)

    expect(await handoffs().markOverdue(now)).toEqual([outreach.id])

    const after = await reload(row.id)
    expect(after.status).toBe(OutreachHandoffStatus.queued)
    expect(after.needsHumanReason).toBe('overdue')
    expect(after.needsHumanAt).toEqual(now)
    expect(slackMessage).toHaveBeenCalledTimes(1)
    const text = JSON.stringify(slackMessage.mock.calls[0]?.[0])
    expect(text).toContain(`Outreach: ${outreach.id}`)
    expect(text).toContain('Nov 10, 11:00 AM PST')

    expect(
      await handoffs().markOverdue(new Date(now.getTime() + 60_000)),
    ).toEqual([])
    expect(slackMessage).toHaveBeenCalledTimes(1)
  })

  it('leaves a row more than an hour out alone', async () => {
    const { row } = await handoff()

    expect(await handoffs().markOverdue(minutesBefore(61))).toEqual([])

    expect((await reload(row.id)).status).toBe(OutreachHandoffStatus.queued)
    expect(slackMessage).not.toHaveBeenCalled()
  })

  it('leaves a replies_submitted row alone', async () => {
    const { row } = await handoff({
      status: OutreachHandoffStatus.replies_submitted,
    })

    expect(await handoffs().markOverdue(minutesBefore(30))).toEqual([])

    expect((await reload(row.id)).needsHumanAt).toBeNull()
    expect(slackMessage).not.toHaveBeenCalled()
  })

  it('leaves manual rows alone', async () => {
    const { row } = await handoff({ handler: OutreachHandoffHandler.manual })

    await handoffs().markOverdue(minutesBefore(30))

    expect((await reload(row.id)).status).toBe(OutreachHandoffStatus.queued)
    expect(slackMessage).not.toHaveBeenCalled()
  })

  it('posts once when overlapping runs race on the same row', async () => {
    await handoff()
    const now = minutesBefore(30)

    const results = await Promise.all([
      handoffs().markOverdue(now),
      handoffs().markOverdue(now),
      handoffs().markOverdue(now),
    ])

    expect(results.flat()).toHaveLength(1)
    expect(slackMessage).toHaveBeenCalledTimes(1)
  })

  it('keeps the row flagged when Slack fails', async () => {
    const { row } = await handoff()
    slackMessage.mockRejectedValue(new Error('slack down'))

    await handoffs().markOverdue(minutesBefore(30))

    expect((await reload(row.id)).needsHumanAt).toEqual(minutesBefore(30))
  })
})

describe('needs_human alarm count', () => {
  it('counts a flagged row only until its send time passes', async () => {
    const counter = vi.mocked(recordManagedPanelHandoffAlarm)
    counter.mockClear()
    await handoff()

    await handoffs().markOverdue(minutesBefore(30))
    expect(counter).toHaveBeenCalledWith('needs_human', 1)

    counter.mockClear()
    await handoffs().markOverdue(new Date(SEND_AT.getTime() + 60_000))
    expect(counter).toHaveBeenCalledWith('needs_human', 0)
  })
})

describe('OutreachTextHandoffService.sweepOverdue', () => {
  it('does nothing on a preview stack', async () => {
    vi.stubEnv('OTEL_SERVICE_ENVIRONMENT', 'preview')
    const markOverdue = vi.spyOn(handoffs(), 'markOverdue')

    await handoffs().sweepOverdue()

    expect(markOverdue).not.toHaveBeenCalled()
    vi.unstubAllEnvs()
  })

  it('runs on dev', async () => {
    vi.stubEnv('OTEL_SERVICE_ENVIRONMENT', 'dev')
    const markOverdue = vi
      .spyOn(handoffs(), 'markOverdue')
      .mockResolvedValue([])

    await handoffs().sweepOverdue()

    expect(markOverdue).toHaveBeenCalledTimes(1)
    vi.unstubAllEnvs()
  })
})
