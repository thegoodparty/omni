import { Client } from '@hubspot/api-client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { HubspotService } from '@/crm/hubspot.service'
import { CrmCampaignsService } from './crmCampaigns.service'

const service = useTestService()

const OTHER_USER_ID = 456

const seedCampaign = async (suffix: string) => {
  const org = await service.prisma.organization.create({
    data: { slug: `assistant-chats-org-${suffix}`, ownerId: service.user.id },
  })
  return service.prisma.campaign.create({
    data: {
      userId: service.user.id,
      slug: `assistant-chats-run-${suffix}`,
      details: {},
      data: { hubspotId: 'hs-1' },
      organizationSlug: org.slug,
    },
  })
}

const seedChat = (
  userId: number,
  threadId: string,
  campaignId: number | null,
  id?: number,
) =>
  service.prisma.aiChat.create({
    data: {
      ...(id ? { id } : {}),
      userId,
      threadId,
      campaignId,
      assistant: 'test-assistant',
    },
  })

describe('CrmCampaignsService — campaign_assistant_chats', () => {
  let companyUpdate: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    await service.prisma.user.create({
      data: { id: OTHER_USER_ID, email: 'other@goodparty.org' },
    })

    const hubspot = service.app.get(HubspotService)
    companyUpdate = vi.fn().mockResolvedValue({ id: 'hs-1' })
    vi.spyOn(hubspot, 'isConfigured', 'get').mockReturnValue(true)
    // The service only touches basicApi.update on this path, so a partial
    // stub is enough to capture the synced properties.
    vi.spyOn(hubspot, 'client', 'get').mockReturnValue({
      crm: { companies: { basicApi: { update: companyUpdate } } },
    } as unknown as Client)
  })

  const syncedProperties = () => companyUpdate.mock.calls.at(0)?.[1].properties

  it('counts only the AiChat rows for this campaign and user', async () => {
    const campaign = await seedCampaign('a')
    const otherCampaign = await seedCampaign('b')

    await seedChat(service.user.id, 'thread-a1', campaign.id)
    await seedChat(service.user.id, 'thread-a2', campaign.id)
    await seedChat(service.user.id, 'thread-a3', campaign.id)
    // Same user, a different campaign — must not inflate this campaign's count.
    await seedChat(service.user.id, 'thread-a-other', otherCampaign.id)
    // A different user whose PK id collides with the campaign user's id — the
    // original `where: { id: userId }` bug counted this row (and only it), so
    // the old synced value would have been 1 instead of 3.
    await seedChat(OTHER_USER_ID, 'thread-b1', campaign.id, service.user.id)

    await service.app.get(CrmCampaignsService).trackCampaign(campaign.id)

    expect(companyUpdate).toHaveBeenCalledTimes(1)
    // HubSpot properties are serialized to strings by the response schema.
    expect(syncedProperties()).toMatchObject({ campaign_assistant_chats: '3' })
  })

  it('syncs zero when the campaign has no AiChat rows', async () => {
    const campaign = await seedCampaign('a')
    const otherCampaign = await seedCampaign('b')
    await seedChat(service.user.id, 'thread-a-other', otherCampaign.id)
    await seedChat(OTHER_USER_ID, 'thread-b1', campaign.id)

    await service.app.get(CrmCampaignsService).trackCampaign(campaign.id)

    expect(syncedProperties()).toMatchObject({ campaign_assistant_chats: '0' })
  })
})
