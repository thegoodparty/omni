import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { LlmService } from '@/llm/services/llm.service'
import { Campaign } from '../../generated/prisma'

const service = useTestService()

const jsonCompletion = vi.fn()

let campaign: Campaign
let orgSlug: string

beforeEach(async () => {
  const llmSvc = service.app.get(LlmService)
  vi.spyOn(llmSvc, 'jsonCompletion').mockImplementation(jsonCompletion)

  const campaignId = 997
  orgSlug = `campaign-${campaignId}`

  await service.prisma.organization.create({
    data: { slug: orgSlug, ownerId: service.user.id, positionId: 'pos-1' },
  })

  campaign = await service.prisma.campaign.create({
    data: {
      id: campaignId,
      organizationSlug: orgSlug,
      userId: service.user.id,
      slug: 'jane-doe',
      isPro: true,
      details: {
        state: 'TX',
        city: 'Georgetown',
        zip: '78634',
        normalizedOffice: 'City Council',
      },
      data: {},
      aiContent: {},
    },
  })
})

const orgHeaders = () => ({ headers: { 'x-organization-slug': orgSlug } })

const postDraft = (body: object) =>
  service.client.post('/v1/outreach/robocall/draft', body, orgHeaders())

const mockDraft = (draft: string) =>
  jsonCompletion.mockResolvedValue({
    object: { draft },
    tokens: 50,
    inputTokens: 25,
    outputTokens: 25,
    model: 'claude-test',
  })

const userContent = () => {
  const call = jsonCompletion.mock.calls[0]?.[0]
  return call.messages.find((m: { role: string }) => m.role === 'user')
    ?.content as string
}

const systemContent = () => {
  const call = jsonCompletion.mock.calls[0]?.[0]
  return call.messages.find((m: { role: string }) => m.role === 'system')
    ?.content as string
}

describe('POST /v1/outreach/robocall/draft', () => {
  it('returns the generated script grounded in office and place', async () => {
    mockDraft('Hi, this is Jane Doe, and I am running for City Council.')

    const res = await postDraft({ purpose: 'introduce_myself', tone: 'warm' })

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data).toEqual({
      draft: 'Hi, this is Jane Doe, and I am running for City Council.',
    })

    expect(jsonCompletion).toHaveBeenCalledTimes(1)
    const call = jsonCompletion.mock.calls[0]?.[0]
    expect(call.temperature).toBe(0.8)
    const userPrompt = userContent()
    expect(userPrompt).toContain('introduce the candidate to voters')
    expect(userPrompt).toContain('Warm:')
    expect(userPrompt).toContain('City Council')
    expect(userPrompt).toContain(
      'Where the candidate is running: Georgetown, TX.',
    )
  })

  it('feeds campaign story and issues into the prompt', async () => {
    await service.prisma.campaignStory.create({
      data: {
        campaignId: campaign.id,
        background: 'I grew up here and coach little league on weekends.',
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

    mockDraft('A grounded script.')

    const res = await postDraft({ purpose: 'introduce_myself', tone: 'warm' })
    expect(res.status).toBe(HttpStatus.CREATED)

    const userPrompt = userContent()
    expect(userPrompt).toContain(
      'I grew up here and coach little league on weekends.',
    )
    expect(userPrompt).toContain('Housing: Build more affordable units')
  })

  it('requires the candidate self-ID opener and bans compliance lines', async () => {
    mockDraft('A script.')

    const res = await postDraft({ purpose: 'introduce_myself', tone: 'warm' })
    expect(res.status).toBe(HttpStatus.CREATED)

    const systemPrompt = systemContent()
    expect(systemPrompt).toContain('Hi, this is')
    expect(systemPrompt).toContain('and I am running for')
    expect(systemPrompt).toContain('"Paid for by"')
    expect(systemPrompt).toContain('callback phone number')
    expect(systemPrompt).toContain('"Reply STOP"')
  })

  it.each(['early_voting', 'election_day_turnout'])(
    'includes voting logistics placeholders for %s',
    async (purpose) => {
      mockDraft('A script.')

      const res = await postDraft({ purpose, tone: 'urgent' })
      expect(res.status).toBe(HttpStatus.CREATED)

      expect(userContent()).toContain('voting logistics as bracketed')
    },
  )

  it('polishes the given text when currentDraft is present', async () => {
    mockDraft('A clearer version of my own words.')

    const res = await postDraft({
      purpose: 'introduce_myself',
      tone: 'direct',
      currentDraft: 'Hi, this is Jane, running for council.',
    })

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data).toEqual({ draft: 'A clearer version of my own words.' })

    expect(systemContent()).toContain('polish')
    expect(systemContent()).toContain(
      'Every concrete detail in the original MUST appear in your output',
    )
    const userPrompt = userContent()
    expect(userPrompt).toContain('Hi, this is Jane, running for council.')
    expect(userPrompt).toContain('Polish the script.')
    expect(userPrompt).not.toContain('Write the robocall script.')
  })

  it('allows improve mode for the custom purpose', async () => {
    mockDraft('Polished custom words.')

    const res = await postDraft({
      purpose: 'custom',
      tone: 'warm',
      currentDraft: 'Entirely my words, roughly phrased.',
    })

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data).toEqual({ draft: 'Polished custom words.' })
  })

  it('rejects fresh generation for the custom purpose without the LLM', async () => {
    const res = await postDraft({ purpose: 'custom', tone: 'warm' })

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(jsonCompletion).not.toHaveBeenCalled()
  })

  it('rejects invalid input without calling the LLM', async () => {
    const badTone = await postDraft({
      purpose: 'persuade_voters',
      tone: 'sarcastic',
    })
    expect(badTone.status).toBe(HttpStatus.BAD_REQUEST)

    const badPurpose = await postDraft({
      purpose: 'world_domination',
      tone: 'warm',
    })
    expect(badPurpose.status).toBe(HttpStatus.BAD_REQUEST)

    expect(jsonCompletion).not.toHaveBeenCalled()
  })

  it('maps an LLM failure to 502', async () => {
    jsonCompletion.mockRejectedValue(new Error('model unavailable'))

    const res = await postDraft({ purpose: 'persuade_voters', tone: 'urgent' })

    expect(res.status).toBe(HttpStatus.BAD_GATEWAY)
  })

  it('rejects a non-Pro campaign with a 400', async () => {
    await service.prisma.campaign.update({
      where: { id: campaign.id },
      data: { isPro: false },
    })

    const res = await postDraft({ purpose: 'introduce_myself', tone: 'warm' })

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(jsonCompletion).not.toHaveBeenCalled()
  })
})
