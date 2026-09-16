import { useTestService } from '@/test-service'
import { beforeEach, describe, expect, it } from 'vitest'
import { Campaign } from '../../../generated/prisma'
import { CampaignStoryIntakeService } from './campaignStoryIntake.service'
import { buildCampaignStoryTool } from './campaignStoryTool'

const service = useTestService()

const WHY = 'The council ignored our street for two years, so I ran.'
const BACKGROUND = 'Grew up here, ran a small business on Main Street.'
const POSITIONS = [
  { title: 'Safer streets', description: 'Fix the crossings.' },
]

// Walks the intake the way the manager does — one save per answer — against a
// real Postgres, so a drop-off after any single answer is proven durable and
// each answer is proven to land in its own store.
describe('Campaign Story intake persistence', () => {
  let campaign: Campaign
  let tool: ReturnType<typeof buildCampaignStoryTool>

  const about = async (): Promise<
    NonNullable<PrismaJson.WebsiteContent['about']>
  > => {
    const site = await service.prisma.website.findUnique({
      where: { campaignId: campaign.id },
    })
    return site?.content?.about ?? {}
  }

  const background = async (): Promise<string | null | undefined> => {
    const row = await service.prisma.campaignStory.findUnique({
      where: { campaignId: campaign.id },
    })
    return row?.background
  }

  beforeEach(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const orgSlug = `story-intake-${suffix}`
    await service.prisma.organization.create({
      data: { slug: orgSlug, ownerId: service.user.id },
    })
    campaign = await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: `story-intake-campaign-${suffix}`,
        organizationSlug: orgSlug,
      },
    })
    tool = buildCampaignStoryTool({
      intake: service.app.get(CampaignStoryIntakeService),
      campaignId: campaign.id,
      candidateName: 'Johnny Goodparty',
    })
  })

  it('keeps the first answer when the candidate drops off straight after it', async () => {
    expect(
      await tool.execute({ action: 'save', field: 'why', text: WHY }),
    ).toEqual({ saved: 'why' })

    expect((await about()).bio).toBe(WHY)
    // Nothing else was answered, so nothing else was written.
    expect(await background()).toBeUndefined()
    expect((await about()).issues ?? []).toEqual([])

    // And the intake knows to resume at the next unanswered question.
    const story = await service.app
      .get(CampaignStoryIntakeService)
      .read(campaign.id)
    expect(story.why).toBe(WHY)
    expect(story.missing).toEqual(['background', 'positions'])
    expect(story.complete).toBe(false)
  })

  it('lands each answer in its own store as it is given', async () => {
    await tool.execute({ action: 'save', field: 'why', text: WHY })
    expect((await about()).bio).toBe(WHY)
    expect(await background()).toBeUndefined()

    await tool.execute({
      action: 'save',
      field: 'background',
      text: BACKGROUND,
    })
    expect(await background()).toBe(BACKGROUND)
    // Saving the background did not disturb the why.
    expect((await about()).bio).toBe(WHY)

    await tool.execute({
      action: 'save',
      field: 'positions',
      positions: POSITIONS,
    })

    // All three now coexist, each read back from its own home.
    expect((await about()).bio).toBe(WHY)
    expect(await background()).toBe(BACKGROUND)
    expect((await about()).issues).toEqual(POSITIONS)

    const story = await service.app
      .get(CampaignStoryIntakeService)
      .read(campaign.id)
    expect(story.complete).toBe(true)
    expect(story.missing).toEqual([])
  })

  it('replaces only the rewritten field when an approved rewrite is saved', async () => {
    await tool.execute({ action: 'save', field: 'why', text: WHY })
    await tool.execute({
      action: 'save',
      field: 'background',
      text: BACKGROUND,
    })

    const approved = 'Two years of being ignored is why I am running.'
    await tool.execute({ action: 'save', field: 'why', text: approved })

    expect((await about()).bio).toBe(approved)
    expect(await background()).toBe(BACKGROUND)
  })
})
