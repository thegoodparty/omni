import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { LlmService } from '@/llm/services/llm.service'

const service = useTestService()

const jsonCompletion = vi.fn()

let orgSlug: string

beforeEach(async () => {
  const llmSvc = service.app.get(LlmService)
  vi.spyOn(llmSvc, 'jsonCompletion').mockImplementation(jsonCompletion)

  const campaignId = 998
  orgSlug = `campaign-${campaignId}`

  await service.prisma.organization.create({
    data: { slug: orgSlug, ownerId: service.user.id, positionId: 'pos-1' },
  })

  await service.prisma.campaign.create({
    data: {
      id: campaignId,
      organizationSlug: orgSlug,
      userId: service.user.id,
      slug: 'jane-doe-sms',
      details: { state: 'TX', zip: '78634', normalizedOffice: 'City Council' },
      data: {},
      aiContent: {},
    },
  })
})

const postDraft = (body: object) =>
  service.client.post('/v1/outreach/sms/draft', body, {
    headers: { 'x-organization-slug': orgSlug },
  })

const llmDraft = (draft: string) => ({
  object: { draft },
  tokens: 50,
  inputTokens: 25,
  outputTokens: 25,
  model: 'claude-test',
})

describe('POST /v1/outreach/sms/draft', () => {
  it('returns the generated body and prompts with purpose, tone, office', async () => {
    jsonCompletion.mockResolvedValue(
      llmDraft('A short note asking neighbors for their vote.'),
    )

    const res = await postDraft({ purpose: 'introduce_myself', tone: 'warm' })

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data).toEqual({
      draft: 'A short note asking neighbors for their vote.',
    })

    expect(jsonCompletion).toHaveBeenCalledTimes(1)
    const call = jsonCompletion.mock.calls[0]?.[0]
    expect(call.temperature).toBe(0.8)
    const systemPrompt = call.messages.find(
      (m: { role: string }) => m.role === 'system',
    )?.content
    expect(systemPrompt).toContain('SMS')
    expect(systemPrompt).toContain('Do NOT introduce the candidate')
    const userPrompt = call.messages.find(
      (m: { role: string }) => m.role === 'user',
    )?.content
    expect(userPrompt).toContain('introduce the candidate to voters')
    expect(userPrompt).toContain('Warm:')
    expect(userPrompt).toContain('City Council')
  })

  it('feeds campaign story, issues, and plan sections into the prompt', async () => {
    const campaign = await service.prisma.campaign.findFirstOrThrow({
      where: { organizationSlug: orgSlug },
    })
    await service.prisma.campaignStory.create({
      data: {
        campaignId: campaign.id,
        background: 'I grew up here and coach little league on weekends.',
      },
    })
    await service.prisma.campaignStrategy.create({
      data: {
        campaignId: campaign.id,
        opportunities: {
          create: [{ order: 1, content: 'High turnout among young renters' }],
        },
        challenges: {
          create: [{ order: 1, content: 'Low name recognition downtown' }],
        },
      },
    })
    await service.prisma.campaign.update({
      where: { id: campaign.id },
      data: {
        details: {
          ...campaign.details,
          customIssues: [
            { title: 'Housing', position: 'Build more affordable units' },
          ],
        },
      },
    })

    jsonCompletion.mockResolvedValue(llmDraft('A grounded SMS body.'))

    const res = await postDraft({ purpose: 'introduce_myself', tone: 'warm' })
    expect(res.status).toBe(HttpStatus.CREATED)

    const call = jsonCompletion.mock.calls[0]?.[0]
    const userPrompt = call.messages.find(
      (m: { role: string }) => m.role === 'user',
    )?.content
    expect(userPrompt).toContain(
      'I grew up here and coach little league on weekends.',
    )
    expect(userPrompt).toContain('Housing: Build more affordable units')
    expect(userPrompt).toContain('High turnout among young renters')
    expect(userPrompt).toContain('Low name recognition downtown')
  })

  it('polishes the given body when currentDraft is present', async () => {
    jsonCompletion.mockResolvedValue(llmDraft('A tighter version.'))

    const res = await postDraft({
      purpose: 'custom',
      tone: 'direct',
      currentDraft: 'Town hall is Saturday at noon at the library.',
    })

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data).toEqual({ draft: 'A tighter version.' })

    const call = jsonCompletion.mock.calls[0]?.[0]
    const systemPrompt = call.messages.find(
      (m: { role: string }) => m.role === 'system',
    )?.content
    expect(systemPrompt).toContain(
      'Every concrete detail in the original MUST appear in your output',
    )
    const userPrompt = call.messages.find(
      (m: { role: string }) => m.role === 'user',
    )?.content
    expect(userPrompt).toContain(
      'Town hall is Saturday at noon at the library.',
    )
  })

  it('rejects custom purpose without currentDraft, and bad input', async () => {
    const custom = await postDraft({ purpose: 'custom', tone: 'warm' })
    expect(custom.status).toBe(HttpStatus.BAD_REQUEST)

    const badPurpose = await postDraft({
      purpose: 'issue_update',
      tone: 'warm',
    })
    expect(badPurpose.status).toBe(HttpStatus.BAD_REQUEST)

    const oversized = await postDraft({
      purpose: 'introduce_myself',
      tone: 'warm',
      currentDraft: 'x'.repeat(481),
    })
    expect(oversized.status).toBe(HttpStatus.BAD_REQUEST)

    expect(jsonCompletion).not.toHaveBeenCalled()
  })

  it('maps an LLM failure to 502', async () => {
    jsonCompletion.mockRejectedValue(new Error('model unavailable'))

    const res = await postDraft({ purpose: 'early_voting', tone: 'urgent' })

    expect(res.status).toBe(HttpStatus.BAD_GATEWAY)
  })
})
