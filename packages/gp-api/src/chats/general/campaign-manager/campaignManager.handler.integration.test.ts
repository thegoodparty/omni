import { addDays, format, parseISO, subDays } from 'date-fns'
import { v7 as uuidv7 } from 'uuid'
import {
  ChatMessageRole,
  ChatScope,
  ConstituentFeedbackCaptureMethod,
  ConstituentFeedbackChannel,
  OfficeLevel,
  OutreachStatus,
  OutreachType,
} from '../../../generated/prisma'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { ChatStoreService } from '@/chats/services/chatStore.prisma'
import { FeaturesService } from '@/features/services/features.service'
import type { LlmTool } from '@/llm/services/llm.service'
import { GeneralChatsService } from '../services/general-chats.service'
import type {
  OutreachFeedback,
  PastOutreachRow,
} from '../priority-flow/services/priorityFlowOutreach.service'
import { CampaignManagerHandler } from './campaignManager.handler'

const service = useTestService()

describe('CampaignManagerHandler.loadContext (integration)', () => {
  it('assembles office, location, and the top dynamic tracker tasks', async () => {
    const handler = service.app.get(CampaignManagerHandler)
    const userId = service.user.id
    const slug = `cam-${userId}-${Math.random().toString(36).slice(2, 10)}`

    await service.prisma.organization.create({
      data: { slug, ownerId: userId },
    })
    const campaign = await service.prisma.campaign.create({
      data: {
        organizationSlug: slug,
        slug,
        userId,
        details: {
          normalizedOffice: 'City Council',
          city: 'Springfield',
          state: 'IL',
          electionDate: '2099-11-03',
        },
      },
    })
    await service.prisma.campaignTrackerTask.createMany({
      data: [
        {
          campaignId: campaign.id,
          title: 'Knock 50 doors in Ward 3',
          description: 'Door knocking',
          week: 1,
          date: new Date('2026-07-06T00:00:00Z'),
          isDefaultTask: false,
        },
        {
          campaignId: campaign.id,
          title: 'Register to be on the ballot',
          description: 'Static setup task',
          week: 1,
          date: new Date('2026-07-01T00:00:00Z'),
          isDefaultTask: true,
        },
      ],
    })
    const conversation = await service.prisma.chatConversation.create({
      data: {
        ownerUserId: userId,
        organizationSlug: slug,
        scope: ChatScope.campaign_assistant,
      },
    })

    const ctx = await handler.loadContext(conversation.id, userId)

    expect(ctx.officeName).toBe('City Council')
    expect(ctx.location).toBe('Springfield, IL')
    expect(ctx.topTasks.map((t) => t.title)).toEqual([
      'Knock 50 doors in Ward 3',
    ])
    expect(ctx.electionDate).toBe('2099-11-03')
    expect(handler.buildSystemPrompt(ctx)).toContain(
      'Election date on record: Tuesday, November 3, 2099',
    )
  })
})

describe('CampaignManagerHandler.loadContext SMS cutoff (integration)', () => {
  const electionIn = (days: number): string =>
    format(addDays(new Date(), days), 'yyyy-MM-dd')

  const conversationFor = async (electionDate: string) => {
    const userId = service.user.id
    const slug = `cam-${userId}-${Math.random().toString(36).slice(2, 10)}`
    await service.prisma.organization.create({
      data: { slug, ownerId: userId },
    })
    const campaign = await service.prisma.campaign.create({
      data: { organizationSlug: slug, slug, userId, details: { electionDate } },
    })
    const conversation = await service.prisma.chatConversation.create({
      data: {
        ownerUserId: userId,
        organizationSlug: slug,
        scope: ChatScope.campaign_assistant,
      },
    })
    return { campaign, conversationId: conversation.id, userId }
  }

  it('closes texting inside the window and tells the prompt', async () => {
    const handler = service.app.get(CampaignManagerHandler)
    const electionDate = electionIn(10)
    const { conversationId, userId } = await conversationFor(electionDate)

    const ctx = await handler.loadContext(conversationId, userId)

    expect(ctx.smsCompliance).toBe('closed')
    expect(ctx.smsCutoffDate).toBe(
      format(subDays(parseISO(electionDate), 19), 'yyyy-MM-dd'),
    )
    expect(handler.buildSystemPrompt(ctx)).toContain(
      'TEXTING IS CLOSED FOR THIS RACE',
    )
  })

  it('keeps texting open for a campaign that filed and paid in time', async () => {
    const handler = service.app.get(CampaignManagerHandler)
    const { campaign, conversationId, userId } = await conversationFor(
      electionIn(10),
    )
    await service.prisma.tcrCompliance.create({
      data: {
        campaignId: campaign.id,
        ein: '12-3456789',
        postalAddress: '1 Main St, Springfield, IL 62701',
        committeeName: 'Friends of Renee',
        websiteDomain: 'reneediaz.com',
        filingUrl: 'https://example.com/filing',
        phone: '5555550100',
        email: 'renee@example.com',
        officeLevel: OfficeLevel.local,
        kickoffSentAt: new Date(),
      },
    })

    const ctx = await handler.loadContext(conversationId, userId)

    expect(ctx.smsCompliance).toBe('not_applicable')
    expect(handler.buildSystemPrompt(ctx)).not.toContain(
      'TEXTING IS CLOSED FOR THIS RACE',
    )
  })

  it('leaves texting open well before the cutoff', async () => {
    const handler = service.app.get(CampaignManagerHandler)
    const { conversationId, userId } = await conversationFor(electionIn(90))

    const ctx = await handler.loadContext(conversationId, userId)

    expect(ctx.smsCompliance).toBe('open')
  })
})

describe('CampaignManagerHandler door notes (integration)', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const runTool = (tool: LlmTool | undefined, input: object) => {
    if (tool === undefined || !('execute' in tool)) {
      throw new Error('expected an executable tool')
    }
    return tool.execute(input)
  }

  const campaignWithWalk = async () => {
    const userId = service.user.id
    const slug = `cam-${userId}-${Math.random().toString(36).slice(2, 10)}`
    await service.prisma.organization.create({
      data: { slug, ownerId: userId },
    })
    const campaign = await service.prisma.campaign.create({
      data: { organizationSlug: slug, slug, userId, details: {} },
    })
    const filter = await service.prisma.voterFileFilter.create({
      data: { organizationSlug: slug, name: 'Oak Street' },
    })
    const walkWithNote = async (transcript: string) => {
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
      const walk = await service.prisma.outreach.create({
        data: {
          campaignId: campaign.id,
          organizationSlug: slug,
          outreachType: OutreachType.nativeDoorKnocking,
          status: OutreachStatus.in_progress,
          name: 'Oak Street walk',
          voterFileFilterId: filter.id,
          doorKnockingTurfId: turf.id,
        },
      })
      await service.prisma.constituentFeedback.create({
        data: {
          organizationSlug: slug,
          personId: uuidv7(),
          occurredAt: new Date(),
          actorUserId: userId,
          channel: ConstituentFeedbackChannel.door_knock,
          transcript,
          captureMethod: ConstituentFeedbackCaptureMethod.dictation,
          clientKey: uuidv7(),
          outreachId: walk.id,
          confirmedAt: new Date(),
        },
      })
      return walk
    }
    const walk = await walkWithNote('Wants the crosswalk on Oak fixed.')
    const conversation = await service.prisma.chatConversation.create({
      data: {
        ownerUserId: userId,
        organizationSlug: slug,
        scope: ChatScope.campaign_assistant,
      },
    })
    return {
      walk,
      walkWithNote,
      slug,
      conversationId: conversation.id,
      userId,
    }
  }

  it('finds the walk by door knocking and reads what voters said', async () => {
    const handler = service.app.get(CampaignManagerHandler)
    const { walk, conversationId, userId } = await campaignWithWalk()

    const tools = handler.buildTools(
      await handler.loadContext(conversationId, userId),
    )

    const past = (await runTool(tools.read_past_outreach, {
      channel: OutreachType.doorKnocking,
    })) as { sends: PastOutreachRow[] }
    expect(past.sends.map((row) => row.outreachId)).toEqual([walk.id])
    const feedback = (await runTool(tools.read_outreach_feedback, {})) as {
      sends: OutreachFeedback[]
    }
    expect(feedback.sends).toMatchObject([
      {
        outreachId: walk.id,
        heardFrom: 1,
        verbatims: [
          {
            said: 'Wants the crosswalk on Oak fixed.',
            source: 'door_note',
            confirmed: true,
          },
        ],
      },
    ])
  })

  it('reads an archived walk only when asked for it by id', async () => {
    const handler = service.app.get(CampaignManagerHandler)
    const { walk, walkWithNote, conversationId, userId } =
      await campaignWithWalk()
    const older = await walkWithNote('Asked about the park lights.')
    await service.prisma.outreach.update({
      where: { id: older.id },
      data: { archivedAt: new Date() },
    })

    const tools = handler.buildTools(
      await handler.loadContext(conversationId, userId),
    )

    const past = (await runTool(tools.read_past_outreach, {})) as {
      sends: PastOutreachRow[]
    }
    expect(past.sends).toMatchObject([
      { outreachId: walk.id, name: 'Oak Street walk', audience: 'Oak Street' },
    ])
    const recent = (await runTool(tools.read_outreach_feedback, {})) as {
      sends: OutreachFeedback[]
    }
    expect(recent.sends).toMatchObject([
      { outreachId: walk.id, name: 'Oak Street walk' },
    ])
    const asked = (await runTool(tools.read_outreach_feedback, {
      outreachId: older.id,
    })) as { sends: OutreachFeedback[] }
    expect(asked.sends).toMatchObject([
      {
        outreachId: older.id,
        verbatims: [{ said: 'Asked about the park lights.' }],
      },
    ])
  })

  it('reads only the doors when asked about the doors', async () => {
    const handler = service.app.get(CampaignManagerHandler)
    const { walk, slug, conversationId, userId } = await campaignWithWalk()
    const calls = await service.prisma.outreach.create({
      data: {
        campaignId: walk.campaignId,
        organizationSlug: slug,
        outreachType: OutreachType.nativePhoneBanking,
        status: OutreachStatus.in_progress,
        name: 'Listening calls',
      },
    })
    await service.prisma.constituentFeedback.create({
      data: {
        organizationSlug: slug,
        personId: uuidv7(),
        occurredAt: new Date(),
        actorUserId: userId,
        channel: ConstituentFeedbackChannel.phone_bank,
        transcript: 'Wants the bus to run later.',
        captureMethod: ConstituentFeedbackCaptureMethod.dictation,
        clientKey: uuidv7(),
        outreachId: calls.id,
        confirmedAt: new Date(),
      },
    })

    const tools = handler.buildTools(
      await handler.loadContext(conversationId, userId),
    )
    const read = async (channel: OutreachType) =>
      (
        (await runTool(tools.read_outreach_feedback, { channel })) as {
          sends: OutreachFeedback[]
        }
      ).sends

    expect(await read(OutreachType.doorKnocking)).toMatchObject([
      {
        outreachId: walk.id,
        verbatims: [{ said: 'Wants the crosswalk on Oak fixed.' }],
      },
    ])
    expect(await read(OutreachType.phoneBanking)).toMatchObject([
      {
        outreachId: calls.id,
        verbatims: [{ said: 'Wants the bus to run later.' }],
      },
    ])
  })

  it('leaves the notes out with issue-capture off for the user', async () => {
    const handler = service.app.get(CampaignManagerHandler)
    const isFeatureEnabled = vi
      .spyOn(service.app.get(FeaturesService), 'isFeatureEnabled')
      .mockResolvedValue(false)
    const { conversationId, userId } = await campaignWithWalk()

    const ctx = await handler.loadContext(conversationId, userId)

    expect(isFeatureEnabled).toHaveBeenCalledWith({
      user: userId,
      feature: 'issue-capture',
    })
    expect(Object.keys(handler.buildTools(ctx))).not.toContain(
      'read_outreach_feedback',
    )
    expect(handler.buildSystemPrompt(ctx)).not.toContain(
      'read_outreach_feedback',
    )
  })
})

describe('campaign manager conversations (integration)', () => {
  it('starts a fresh conversation per open, each seeded with the greeting', async () => {
    const chats = service.app.get(GeneralChatsService)
    const chatStore = service.app.get(ChatStoreService)
    const userId = service.user.id
    const slug = `cam-${userId}-${Math.random().toString(36).slice(2, 10)}`
    await service.prisma.organization.create({
      data: { slug, ownerId: userId },
    })
    const params = {
      scope: ChatScope.campaign_assistant,
      organizationSlug: slug,
    }

    const first = await chats.resolveConversation(params, userId)
    const second = await chats.resolveConversation(params, userId)

    expect(first.created).toBe(true)
    expect(second.created).toBe(true)
    expect(second.conversationId).not.toBe(first.conversationId)

    const messages = await chatStore.listMessagesByConversation(
      second.conversationId,
    )
    expect(messages).toHaveLength(1)
    expect(messages[0]?.role).toBe(ChatMessageRole.assistant)
    expect(messages[0]?.content.toLowerCase()).toContain('campaign manager')
  })
})
