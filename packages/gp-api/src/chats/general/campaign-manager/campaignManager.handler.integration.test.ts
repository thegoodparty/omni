import { addDays, format, parseISO, subDays } from 'date-fns'
import {
  ChatMessageRole,
  ChatScope,
  OfficeLevel,
} from '../../../generated/prisma'
import { describe, expect, it } from 'vitest'
import { useTestService } from '@/test-service'
import { ChatStoreService } from '@/chats/services/chatStore.prisma'
import { GeneralChatsService } from '../services/general-chats.service'
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
