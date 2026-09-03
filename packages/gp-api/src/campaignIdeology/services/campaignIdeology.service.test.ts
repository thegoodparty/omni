import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { LlmService } from '@/llm/services/llm.service'
import { Campaign } from '../../generated/prisma'
import { CampaignIdeologyService } from './campaignIdeology.service'

const service = useTestService()

const jsonCompletion = vi.fn()

let campaign: Campaign
let ideologyService: CampaignIdeologyService

beforeEach(async () => {
  jsonCompletion.mockReset()
  const llmSvc = service.app.get(LlmService)
  vi.spyOn(llmSvc, 'jsonCompletion').mockImplementation(jsonCompletion)
  ideologyService = service.app.get(CampaignIdeologyService)

  const orgSlug = `campaign-ideology-${randomUUID()}`
  await service.prisma.organization.create({
    data: { slug: orgSlug, ownerId: service.user.id },
  })

  campaign = await service.prisma.campaign.create({
    data: {
      organizationSlug: orgSlug,
      userId: service.user.id,
      slug: orgSlug,
    },
  })
})

const llmResult = (
  bucket: string | null,
  evidence = 'the stated evidence',
) => ({
  object: { bucket, evidence },
  tokens: 10,
  inputTokens: 5,
  outputTokens: 5,
  model: 'claude-sonnet-4-6',
})

const createWebsiteAbout = (about: {
  bio?: string
  issues?: { title: string; description: string }[]
}) =>
  service.prisma.website.create({
    data: {
      campaignId: campaign.id,
      vanityPath: randomUUID(),
      content: { about },
    },
  })

describe('CampaignIdeologyService.bucketForCampaign', () => {
  it('returns null when the campaign has no platform or story', async () => {
    const result = await ideologyService.bucketForCampaign(campaign.id)

    expect(result).toBeNull()
    expect(jsonCompletion).not.toHaveBeenCalled()
  })

  it('persists the bucket, evidence, model and input hash', async () => {
    await createWebsiteAbout({
      bio: 'I am running to expand affordable housing.',
      issues: [{ title: 'Housing', description: 'Build more housing.' }],
    })
    jsonCompletion.mockResolvedValue(
      llmResult('progressive', 'stated support for expanding housing supply'),
    )

    const result = await ideologyService.bucketForCampaign(campaign.id)

    expect(result).toBe('progressive')
    const row = await service.prisma.campaignIdeology.findUnique({
      where: { campaignId: campaign.id },
    })
    expect(row).toMatchObject({ bucket: 'progressive' })
    expect(row?.evidence).toBeTruthy()
    expect(row?.inputHash).toBeTruthy()
    expect(row?.model).toBeTruthy()
  })

  it('does not call the model again when the input is unchanged', async () => {
    await createWebsiteAbout({ bio: 'Why I am running for city council.' })
    jsonCompletion.mockResolvedValue(llmResult('moderate'))

    await ideologyService.bucketForCampaign(campaign.id)
    await ideologyService.bucketForCampaign(campaign.id)

    expect(jsonCompletion).toHaveBeenCalledTimes(1)
  })

  it('recomputes when the input text changes', async () => {
    const website = await createWebsiteAbout({
      bio: 'Version one of my story.',
    })
    jsonCompletion.mockResolvedValue(llmResult('moderate'))
    await ideologyService.bucketForCampaign(campaign.id)

    await service.prisma.website.update({
      where: { id: website.id },
      data: { content: { about: { bio: 'Version two of my story.' } } },
    })
    jsonCompletion.mockResolvedValue(llmResult('conservative'))
    await ideologyService.bucketForCampaign(campaign.id)

    expect(jsonCompletion).toHaveBeenCalledTimes(2)
  })

  // The most important property of this classifier: a thin, purely
  // biographical input (here, only the weak CampaignStory.background signal
  // — no website bio, no stated issues) must abstain rather than fall back
  // to a plausible-looking default, and that abstention must be stored so
  // the next request doesn't re-pay for the same answer.
  it('abstains and persists the null on thin, purely biographical input', async () => {
    await service.prisma.campaignStory.create({
      data: {
        campaignId: campaign.id,
        background: 'I grew up here and have three kids in the local schools.',
      },
    })
    jsonCompletion.mockResolvedValue(
      llmResult(null, 'purely biographical, no stated positions'),
    )

    const first = await ideologyService.bucketForCampaign(campaign.id)
    const second = await ideologyService.bucketForCampaign(campaign.id)

    expect(first).toBeNull()
    expect(second).toBeNull()
    expect(jsonCompletion).toHaveBeenCalledTimes(1)
    const row = await service.prisma.campaignIdeology.findUnique({
      where: { campaignId: campaign.id },
    })
    expect(row).toMatchObject({ bucket: null })
    expect(row?.evidence).toBeTruthy()
    expect(row?.inputHash).toBeTruthy()
  })

  it('returns null rather than throwing when the model call fails', async () => {
    await createWebsiteAbout({ bio: 'Why I am running.' })
    jsonCompletion.mockRejectedValue(new Error('LLM call failed'))

    const result = await ideologyService.bucketForCampaign(campaign.id)

    expect(result).toBeNull()
    const row = await service.prisma.campaignIdeology.findUnique({
      where: { campaignId: campaign.id },
    })
    expect(row).toBeNull()
  })
})
