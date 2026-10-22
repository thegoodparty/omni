import { useTestService } from '@/test-service'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { v7 as uuidv7 } from 'uuid'
import {
  ConstituentFeedbackCaptureMethod,
  ConstituentFeedbackChannel,
  ConstituentFeedbackStance,
  OutreachStatus,
  OutreachType,
  PollIndividualMessageSender,
  PrioritySource,
  SynthesisRunStatus,
  SynthesisScope,
} from '../../../../generated/prisma'
import { PriorityFlowOutreachService } from './priorityFlowOutreach.service'
import { buildReadPastOutreachTool } from '../../chat-tools/readPastOutreach.tool'

// Runs against real Postgres on purpose. The bug this guards is SQL NULL
// semantics — `priority_id <> $1` is never true for a NULL row — which a
// mocked Prisma would happily "pass".
const service = useTestService()

const ZONE = 'US/Eastern'

let outreach: PriorityFlowOutreachService
let slug: string
let officeId: string

const createPriority = async (title: string) =>
  (
    await service.prisma.priority.create({
      data: {
        electedOfficeId: officeId,
        title,
        description: title,
        source: PrioritySource.user_stated,
      },
    })
  ).id

const send = (name: string, priorityId: string | null) =>
  service.prisma.outreach.create({
    data: {
      organizationSlug: slug,
      outreachType: OutreachType.text,
      status: OutreachStatus.completed,
      name,
      priorityId,
    },
  })

// A native walk's envelope must point at a turf (DB check constraint).
const turfIn = async (organizationSlug: string) => {
  const filter = await service.prisma.voterFileFilter.create({
    data: { organizationSlug, name: `audience ${uuidv7()}` },
  })
  const turf = await service.prisma.doorKnockingTurf.create({
    data: {
      voterFileFilterId: filter.id,
      name: 'Turf A',
      color: '#ff0000',
      geoPoly: {
        type: 'Polygon',
        coordinates: [
          [
            [-87.66, 41.89],
            [-87.64, 41.89],
            [-87.65, 41.91],
            [-87.66, 41.89],
          ],
        ],
      },
    },
  })
  return turf.id
}

beforeEach(async () => {
  outreach = service.app.get(PriorityFlowOutreachService)
  officeId = uuidv7()
  slug = `eo-${officeId}`
  await service.prisma.organization.create({
    data: { slug, ownerId: service.user.id },
  })
  await service.prisma.electedOffice.create({
    data: { id: officeId, userId: service.user.id, organizationSlug: slug },
  })
})

describe('PriorityFlowOutreachService.forOffice', () => {
  it('includes sends with no priority, which is nearly all of them', async () => {
    const bridge = await createPriority('Bridge')
    const market = await createPriority('Market')
    await send('about the bridge', bridge)
    const marketSend = await send('about the market', market)
    const newsletter = await send('office newsletter', null)

    const rows = await outreach.forOffice(slug, bridge, ZONE)

    expect(rows.map((row) => row.outreachId).sort()).toEqual(
      [marketSend.id, newsletter.id].sort(),
    )
  })

  it('holds a widen only when every send put out this side of this check', async () => {
    const bridge = await createPriority('Bridge')
    const market = await createPriority('Market')
    const checkSend = (
      priorityId: string,
      priorityStepId: string,
      priorityCheckSide: string,
    ) =>
      service.prisma.outreach.create({
        data: {
          organizationSlug: slug,
          outreachType: OutreachType.text,
          priorityId,
          priorityStepId,
          priorityCheckSide,
        },
      })
    const first = await checkSend(bridge, 'define', 'main')
    const second = await checkSend(bridge, 'define', 'main')
    const contrast = await checkSend(bridge, 'define', 'contrast')
    const otherStep = await checkSend(bridge, 'options', 'main')
    const otherPriority = await checkSend(market, 'define', 'main')

    const widens = (ids: number[]) =>
      outreach.allPutOutCheck(bridge, 'define', 'main', ids)

    expect(await widens([first.id, second.id])).toBe(true)
    expect(await widens([first.id, contrast.id])).toBe(false)
    expect(await widens([otherStep.id])).toBe(false)
    expect(await widens([otherPriority.id])).toBe(false)
    expect(await widens([first.id, 999_999])).toBe(false)
    expect(await widens([])).toBe(false)
  })

  it('returns every send when the chat is not about a priority', async () => {
    const bridge = await createPriority('Bridge')
    const bridgeSend = await send('about the bridge', bridge)
    const newsletter = await send('office newsletter', null)

    const rows = await outreach.forOffice(slug, null, ZONE)

    expect(rows.map((row) => row.outreachId).sort()).toEqual(
      [bridgeSend.id, newsletter.id].sort(),
    )
  })
})

describe('PriorityFlowOutreachService.forOffice campaign isolation', () => {
  it("leaves out the org's campaign sends", async () => {
    const campaign = await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: `${slug}-campaign`,
        organizationSlug: slug,
      },
    })
    await service.prisma.outreach.create({
      data: {
        campaignId: campaign.id,
        organizationSlug: slug,
        outreachType: OutreachType.text,
        name: 'get out the vote',
      },
    })
    const newsletter = await send('office newsletter', null)

    const rows = await outreach.forOffice(slug, null, ZONE)

    expect(rows.map((row) => row.outreachId)).toEqual([newsletter.id])
  })
})

describe('PriorityFlowOutreachService.forCampaign', () => {
  it("reads only the campaign's sends, not its org's office", async () => {
    const campaign = await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: `${slug}-campaign`,
        organizationSlug: slug,
      },
    })
    const campaignSend = await service.prisma.outreach.create({
      data: {
        campaignId: campaign.id,
        organizationSlug: slug,
        outreachType: OutreachType.text,
        name: 'get out the vote',
      },
    })
    await send('office newsletter', null)

    const rows = await outreach.forCampaign(campaign.id, ZONE)

    expect(rows.map((row) => row.outreachId)).toEqual([campaignSend.id])
  })
})

describe('PriorityFlowOutreachService channel filter', () => {
  const walk = async (data: { campaignId?: number }) =>
    service.prisma.outreach.create({
      data: {
        ...data,
        organizationSlug: slug,
        outreachType: OutreachType.nativeDoorKnocking,
        status: OutreachStatus.in_progress,
        name: 'Oak Street walk',
        doorKnockingTurfId: await turfIn(slug),
      },
    })

  it('finds a native walk when asked for door knocking by either name', async () => {
    const office = await walk({})
    await send('office newsletter', null)

    for (const channel of [
      OutreachType.doorKnocking,
      OutreachType.nativeDoorKnocking,
    ]) {
      const rows = await outreach.forOffice(slug, null, ZONE, channel)
      expect(rows.map((row) => row.outreachId)).toEqual([office.id])
    }
  })

  it("finds a campaign's native walk and call list by the legacy names", async () => {
    const campaign = await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: `${slug}-campaign`,
        organizationSlug: slug,
      },
    })
    const doors = await walk({ campaignId: campaign.id })
    const calls = await service.prisma.outreach.create({
      data: {
        campaignId: campaign.id,
        organizationSlug: slug,
        outreachType: OutreachType.nativePhoneBanking,
        status: OutreachStatus.in_progress,
        name: 'Seniors call list',
      },
    })

    const byChannel = async (channel: OutreachType) =>
      (await outreach.forCampaign(campaign.id, ZONE, channel)).map(
        (row) => row.outreachId,
      )

    expect(await byChannel(OutreachType.doorKnocking)).toEqual([doors.id])
    expect(await byChannel(OutreachType.phoneBanking)).toEqual([calls.id])
    expect(await byChannel(OutreachType.text)).toEqual([])
  })
})

describe('PriorityFlowOutreachService.feedbackForCampaign', () => {
  const createCampaign = async (organizationSlug: string) => {
    if (organizationSlug !== slug) {
      await service.prisma.organization.create({
        data: { slug: organizationSlug, ownerId: service.user.id },
      })
    }
    return service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: `${organizationSlug}-campaign`,
        organizationSlug,
      },
    })
  }

  const note = (
    outreachId: number,
    transcript: string,
    confirmed: boolean,
    issues: { issueLabel: string; stance: ConstituentFeedbackStance }[] = [],
  ) =>
    service.prisma.constituentFeedback.create({
      data: {
        organizationSlug: slug,
        personId: uuidv7(),
        occurredAt: new Date(),
        actorUserId: service.user.id,
        channel: ConstituentFeedbackChannel.door_knock,
        transcript,
        captureMethod: ConstituentFeedbackCaptureMethod.dictation,
        clientKey: uuidv7(),
        outreachId,
        confirmedAt: confirmed ? new Date() : null,
        issues: {
          create: issues.map((issue, position) => ({ ...issue, position })),
        },
      },
    })

  it("reads the campaign's door notes and themes, and only its door and call sends", async () => {
    const campaign = await createCampaign(slug)
    const other = await createCampaign(`${slug}-other`)
    const sendFor = async (
      campaign: { id: number; organizationSlug: string } | null,
      outreachType: OutreachType,
      status: OutreachStatus = OutreachStatus.in_progress,
    ) => {
      const organizationSlug = campaign?.organizationSlug ?? slug
      return service.prisma.outreach.create({
        data: {
          campaignId: campaign?.id ?? null,
          organizationSlug,
          outreachType,
          status,
          name: `${outreachType} ${organizationSlug}`,
          doorKnockingTurfId:
            outreachType === OutreachType.nativeDoorKnocking
              ? await turfIn(organizationSlug)
              : null,
        },
      })
    }
    const walk = await sendFor(campaign, OutreachType.nativeDoorKnocking)
    await sendFor(campaign, OutreachType.text, OutreachStatus.completed)
    await sendFor(
      campaign,
      OutreachType.nativePhoneBanking,
      OutreachStatus.draft,
    )
    await sendFor(other, OutreachType.nativeDoorKnocking)
    await sendFor(null, OutreachType.nativeDoorKnocking)

    const confirmed = await note(
      walk.id,
      'Wants the crosswalk on Oak fixed before school starts.',
      true,
      [
        {
          issueLabel: 'Traffic safety',
          stance: ConstituentFeedbackStance.supports,
        },
      ],
    )
    await note(walk.id, 'Asked about trash pickup days.', false)
    const run = await service.prisma.feedbackSynthesisRun.create({
      data: {
        organizationSlug: slug,
        scope: SynthesisScope.effort,
        outreachId: walk.id,
        status: SynthesisRunStatus.completed,
        completedAt: new Date(),
        conversations: 2,
        memos: 2,
        confirmed: 1,
        engine: 'mock',
      },
    })
    await service.prisma.feedbackTheme.create({
      data: {
        runId: run.id,
        rank: 0,
        title: 'Safer streets near schools',
        summary: 'Neighbors want the crossings fixed.',
        details: '',
        members: { create: [{ feedbackId: confirmed.id }] },
      },
    })

    const sends = await outreach.feedbackForCampaign(campaign.id, ZONE)

    expect(sends.map((row) => row.outreachId)).toEqual([walk.id])
    expect(sends[0]).toMatchObject({
      channel: OutreachType.nativeDoorKnocking,
      heardFrom: 2,
      themes: [
        {
          title: 'Safer streets near schools',
          summary: 'Neighbors want the crossings fixed.',
          people: 1,
        },
      ],
    })
    expect(sends[0]?.verbatims).toEqual([
      {
        said: 'Wants the crosswalk on Oak fixed before school starts.',
        source: 'door_note',
        confirmed: true,
        issues: [{ issue: 'Traffic safety', stance: 'supports' }],
      },
      {
        said: 'Asked about trash pickup days.',
        source: 'door_note',
        confirmed: false,
        issues: [],
      },
    ])
  })

  it("never reads another campaign's send by its id", async () => {
    const campaign = await createCampaign(slug)
    const other = await createCampaign(`${slug}-other`)
    const theirs = await service.prisma.outreach.create({
      data: {
        campaignId: other.id,
        organizationSlug: other.organizationSlug,
        outreachType: OutreachType.nativeDoorKnocking,
        status: OutreachStatus.in_progress,
        doorKnockingTurfId: await turfIn(other.organizationSlug),
      },
    })

    expect(
      await outreach.feedbackForCampaign(campaign.id, ZONE, theirs.id),
    ).toEqual([])
  })
})

describe('PriorityFlowOutreachService.feedbackFor', () => {
  const reply = (
    outreachId: number,
    personId: string,
    content: string,
    isOptOut = false,
  ) =>
    service.prisma.pollIndividualMessage.create({
      data: {
        id: uuidv7(),
        personId,
        outreachId,
        electedOfficeId: officeId,
        sender: PollIndividualMessageSender.CONSTITUENT,
        sentAt: new Date(),
        content,
        isOptOut,
      },
    })

  it("reads a priority's text replies in people's words, without opt-outs", async () => {
    const flooding = await createPriority('Flooding')
    const text = await send('Oak Street homeowners', flooding)
    await service.prisma.outreach.update({
      where: { id: text.id },
      data: { scheduledLocalDate: '2026-10-08' },
    })
    const ana = uuidv7()
    await reply(text.id, ana, 'The drain backs up every storm.')
    await reply(text.id, ana, 'Twice this month.')
    await reply(text.id, uuidv7(), 'STOP', true)
    await send('other priority', await createPriority('Parks'))

    const [feedback, ...rest] = await outreach.feedbackFor(
      slug,
      { priorityId: flooding },
      ZONE,
    )

    expect(rest).toEqual([])
    expect(feedback).toMatchObject({
      outreachId: text.id,
      scheduledFor: '2026-10-08',
      sentOn: '2026-10-08',
      heardFrom: 1,
      verbatimsLeftOut: 0,
      themes: [],
    })
    expect(feedback?.verbatims).toEqual([
      {
        said: 'The drain backs up every storm. / Twice this month.',
        source: 'text_reply',
        confirmed: true,
        issues: [],
      },
    ])
  })

  it('leaves out unpaid drafts and Win sends on the same org', async () => {
    await service.prisma.outreach.create({
      data: {
        organizationSlug: slug,
        outreachType: OutreachType.text,
        status: OutreachStatus.pending_payment,
        name: 'unpaid',
      },
    })
    const sent = await send('newsletter', null)

    const sends = await outreach.feedbackFor(slug, {}, ZONE)

    expect(sends.map((row) => row.outreachId)).toEqual([sent.id])
  })
})

describe('read_past_outreach send days', () => {
  // A Serve text: paid for, handed off (in_progress) at once, and set to go
  // out on its scheduledLocalDate with `date` left null.
  const paidText = (
    priorityId: string,
    status: OutreachStatus,
    scheduledLocalDate: string,
  ) =>
    service.prisma.outreach.create({
      data: {
        organizationSlug: slug,
        outreachType: OutreachType.text,
        status,
        name: 'Riverside renters',
        textCount: 5000,
        scheduledLocalDate,
        priorityId,
      },
    })

  const readFor = (priorityId: string) =>
    buildReadPastOutreachTool({
      outreach,
      priorityId,
      organizationSlug: slug,
      timeZone: ZONE,
    }).execute({})

  // Noon Eastern on Oct 22, five days before the text's day.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-22T16:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('holds a paid text in progress as not sent until its day', async () => {
    const flooding = await createPriority('Flooding')
    const text = await paidText(
      flooding,
      OutreachStatus.in_progress,
      '2026-10-27',
    )

    expect(await readFor(flooding)).toEqual({
      priority: [
        expect.objectContaining({
          outreachId: text.id,
          status: OutreachStatus.in_progress,
          scheduledFor: '2026-10-27',
          sentOn: null,
        }),
      ],
      office: [],
    })
  })

  it('reads it as sent on its day once that day comes', async () => {
    const flooding = await createPriority('Flooding')
    await paidText(flooding, OutreachStatus.in_progress, '2026-10-27')
    // 1:00 am Eastern on Oct 27, the text's day.
    vi.setSystemTime(new Date('2026-10-27T05:00:00.000Z'))

    expect(await readFor(flooding)).toEqual({
      priority: [
        expect.objectContaining({
          scheduledFor: '2026-10-27',
          sentOn: '2026-10-27',
        }),
      ],
      office: [],
    })
  })

  it('reads a completed text as sent and a pending one as not', async () => {
    const flooding = await createPriority('Flooding')
    const done = await paidText(
      flooding,
      OutreachStatus.completed,
      '2026-10-08',
    )
    const waiting = await paidText(
      flooding,
      OutreachStatus.pending,
      '2026-11-10',
    )

    expect(await readFor(flooding)).toEqual({
      priority: expect.arrayContaining([
        expect.objectContaining({
          outreachId: done.id,
          status: OutreachStatus.completed,
          scheduledFor: '2026-10-08',
          sentOn: '2026-10-08',
        }),
        expect.objectContaining({
          outreachId: waiting.id,
          status: OutreachStatus.pending,
          scheduledFor: '2026-11-10',
          sentOn: null,
        }),
      ]),
      office: [],
    })
  })

  it("reads a send's instant as the office's day, not the server's", async () => {
    const flooding = await createPriority('Flooding')
    // 9:30 pm Eastern on Oct 21 is already Oct 22 in UTC.
    const calls = await service.prisma.outreach.create({
      data: {
        organizationSlug: slug,
        outreachType: OutreachType.text,
        status: OutreachStatus.in_progress,
        date: new Date('2026-10-22T01:30:00.000Z'),
        priorityId: flooding,
      },
    })

    expect(await readFor(flooding)).toEqual({
      priority: [
        expect.objectContaining({
          outreachId: calls.id,
          scheduledFor: '2026-10-21',
          sentOn: '2026-10-21',
        }),
      ],
      office: [],
    })
  })

  it('says a scheduled text is not sent yet in the thread line', async () => {
    const flooding = await createPriority('Flooding')
    await paidText(flooding, OutreachStatus.in_progress, '2026-10-27')

    const [anchor] = await outreach.summarizeAnchors(flooding, ZONE)

    expect(anchor?.line).toContain('scheduled for 2026-10-27, not sent yet')
    expect(anchor?.line).not.toContain('sent 2026')
  })

  it('gives read_outreach_feedback the same days', async () => {
    const flooding = await createPriority('Flooding')
    await paidText(flooding, OutreachStatus.in_progress, '2026-10-27')

    const [feedback] = await outreach.feedbackFor(
      slug,
      { priorityId: flooding },
      ZONE,
    )

    expect(feedback).toMatchObject({
      scheduledFor: '2026-10-27',
      sentOn: null,
    })
  })
})
