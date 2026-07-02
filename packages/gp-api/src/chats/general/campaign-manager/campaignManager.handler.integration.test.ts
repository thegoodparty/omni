import { ChatMessageRole, ChatScope } from '../../../generated/prisma'
import { describe, expect, it } from 'vitest'
import { useTestService } from '@/test-service'
import { ChatStoreService } from '@/chats/services/chatStore.prisma'
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
    expect(ctx.weeksToElection).toBeGreaterThan(0)
  })
})

describe('CampaignManagerHandler.resolveConversation (integration)', () => {
  it('seeds the scripted greeting as the first assistant message', async () => {
    const handler = service.app.get(CampaignManagerHandler)
    const chatStore = service.app.get(ChatStoreService)
    const userId = service.user.id
    const slug = `cam-${userId}-${Math.random().toString(36).slice(2, 10)}`
    await service.prisma.organization.create({
      data: { slug, ownerId: userId },
    })

    const { conversationId, created } = await handler.resolveConversation(
      { scope: ChatScope.campaign_assistant, organizationSlug: slug },
      userId,
    )
    expect(created).toBe(true)

    const messages = await chatStore.listMessagesByConversation(conversationId)
    expect(messages).toHaveLength(1)
    expect(messages[0]?.role).toBe(ChatMessageRole.assistant)
    expect(messages[0]?.content.toLowerCase()).toContain('campaign manager')
  })
})
