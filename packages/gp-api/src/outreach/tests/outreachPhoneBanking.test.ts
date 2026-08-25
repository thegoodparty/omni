import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RaceTargetMetrics } from '@goodparty_org/contracts'
import { useTestService } from '@/test-service'
import { CampaignsService } from '@/campaigns/services/campaigns.service'
import { LlmService } from '@/llm/services/llm.service'
import { Campaign } from '../../generated/prisma'

const service = useTestService()

const jsonCompletion = vi.fn()

let campaign: Campaign
let orgSlug: string

beforeEach(async () => {
  const llmSvc = service.app.get(LlmService)
  vi.spyOn(llmSvc, 'jsonCompletion').mockImplementation(jsonCompletion)

  const campaignId = 998
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
  service.client.post('/v1/outreach/phone-banking/draft', body, orgHeaders())

const mockDraft = (draft: string) =>
  jsonCompletion.mockResolvedValue({
    object: { draft },
    tokens: 50,
    inputTokens: 25,
    outputTokens: 25,
    model: 'claude-test',
  })

describe('POST /v1/outreach/phone-banking/draft', () => {
  it('returns the generated script grounded in office and campaign story', async () => {
    mockDraft('Hi, my name is [your name], a volunteer for Jane Doe.')

    const res = await postDraft({ purpose: 'introduce', tone: 'warm' })

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data).toEqual({
      draft: 'Hi, my name is [your name], a volunteer for Jane Doe.',
    })

    expect(jsonCompletion).toHaveBeenCalledTimes(1)
    const call = jsonCompletion.mock.calls[0]?.[0]
    expect(call.temperature).toBe(0.8)
    const userPrompt = call.messages.find(
      (m: { role: string }) => m.role === 'user',
    )?.content
    expect(userPrompt).toContain('introduce the candidate to a voter')
    expect(userPrompt).toContain('Warm:')
    expect(userPrompt).toContain('City Council')
    expect(userPrompt).toContain(
      'Where the candidate is running: Georgetown, TX.',
    )
  })

  it('feeds campaign story, issues, and plan sections into the prompt', async () => {
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

    const res = await postDraft({ purpose: 'introduce', tone: 'warm' })
    expect(res.status).toBe(HttpStatus.CREATED)

    const call = jsonCompletion.mock.calls[0]?.[0]
    const userPrompt = call.messages.find(
      (m: { role: string }) => m.role === 'user',
    )?.content
    expect(userPrompt).toContain(
      'I grew up here and coach little league on weekends.',
    )
    expect(userPrompt).toContain('Housing: Build more affordable units')
  })

  it('includes the volunteer opener and compliance ban in the system prompt', async () => {
    mockDraft('A script.')

    const res = await postDraft({ purpose: 'introduce', tone: 'warm' })
    expect(res.status).toBe(HttpStatus.CREATED)

    const call = jsonCompletion.mock.calls[0]?.[0]
    const systemPrompt = call.messages.find(
      (m: { role: string }) => m.role === 'system',
    )?.content
    expect(systemPrompt).toContain(
      'Hi, my name is [your name], and I am a volunteer for',
    )
    expect(systemPrompt).toContain('no "Reply STOP"')
    expect(systemPrompt).toContain('no "Paid for by"')
    expect(systemPrompt).toContain('no callback phone number')
  })

  it('includes an issue-ID question for the persuade purpose', async () => {
    mockDraft('A script.')

    const res = await postDraft({ purpose: 'persuade', tone: 'direct' })
    expect(res.status).toBe(HttpStatus.CREATED)

    const call = jsonCompletion.mock.calls[0]?.[0]
    const userPrompt = call.messages.find(
      (m: { role: string }) => m.role === 'user',
    )?.content
    expect(userPrompt).toContain('issue-ID question')
    expect(userPrompt).toContain('what matters most to them')
  })

  it.each(['vote-early', 'election-day'])(
    'never instructs bracketed voting-logistics placeholders for %s',
    async (purpose) => {
      mockDraft('A script.')

      const res = await postDraft({ purpose, tone: 'urgent' })
      expect(res.status).toBe(HttpStatus.CREATED)

      const call = jsonCompletion.mock.calls[0]?.[0]
      const userPrompt = call.messages.find(
        (m: { role: string }) => m.role === 'user',
      )?.content
      const systemPrompt = call.messages.find(
        (m: { role: string }) => m.role === 'system',
      )?.content
      expect(userPrompt).not.toContain('bracketed')
      expect(userPrompt).not.toContain('[early voting')
      expect(userPrompt).not.toContain('[polling')
      expect(systemPrompt).toContain(
        'Never emit a bracketed placeholder anywhere in the script other than "[your name]"',
      )
    },
  )

  it('includes the election date for the election-day purpose', async () => {
    await service.prisma.campaign.update({
      where: { id: campaign.id },
      data: { details: { ...campaign.details, electionDate: '2026-11-03' } },
    })
    mockDraft('A script.')

    const res = await postDraft({ purpose: 'election-day', tone: 'urgent' })
    expect(res.status).toBe(HttpStatus.CREATED)

    const call = jsonCompletion.mock.calls[0]?.[0]
    const userPrompt = call.messages.find(
      (m: { role: string }) => m.role === 'user',
    )?.content
    expect(userPrompt).toContain('Election day: November 3, 2026.')
  })

  it('omits a general election date that has already passed', async () => {
    await service.prisma.campaign.update({
      where: { id: campaign.id },
      data: { details: { ...campaign.details, electionDate: '2020-11-03' } },
    })
    mockDraft('A script.')

    const res = await postDraft({ purpose: 'election-day', tone: 'urgent' })
    expect(res.status).toBe(HttpStatus.CREATED)

    const call = jsonCompletion.mock.calls[0]?.[0]
    const userPrompt = call.messages.find(
      (m: { role: string }) => m.role === 'user',
    )?.content
    expect(userPrompt).not.toContain('Election day:')
  })

  it('includes the real early-voting window for the vote-early purpose', async () => {
    const campaignsService = service.app.get(CampaignsService)
    vi.spyOn(
      campaignsService,
      'fetchLiveRaceTargetMetrics',
    ).mockResolvedValueOnce({
      milestones: {
        voter_registration: null,
        early_voting: { start: '2026-10-19', end: '2026-11-01' },
        request_ballot: null,
      },
    } as RaceTargetMetrics)
    mockDraft('A script.')

    const res = await postDraft({ purpose: 'vote-early', tone: 'urgent' })
    expect(res.status).toBe(HttpStatus.CREATED)

    const call = jsonCompletion.mock.calls[0]?.[0]
    const userPrompt = call.messages.find(
      (m: { role: string }) => m.role === 'user',
    )?.content
    expect(userPrompt).toContain(
      'Early voting window: October 19, 2026 through November 1, 2026.',
    )
  })

  it('does not fabricate an early-voting window when only an estimate would exist', async () => {
    // gp-api never returns an estimated early-voting date from
    // fetchLiveRaceTargetMetrics — a null milestone here is exactly what
    // "only an estimate exists" looks like at this layer, and the prompt
    // must not present anything as a real window in that case.
    const campaignsService = service.app.get(CampaignsService)
    vi.spyOn(
      campaignsService,
      'fetchLiveRaceTargetMetrics',
    ).mockResolvedValueOnce({
      milestones: {
        voter_registration: null,
        early_voting: null,
        request_ballot: null,
      },
    } as RaceTargetMetrics)
    mockDraft('A script.')

    const res = await postDraft({ purpose: 'vote-early', tone: 'urgent' })
    expect(res.status).toBe(HttpStatus.CREATED)

    const call = jsonCompletion.mock.calls[0]?.[0]
    const userPrompt = call.messages.find(
      (m: { role: string }) => m.role === 'user',
    )?.content
    expect(userPrompt).not.toContain('Early voting')
  })

  it('polishes the given text instead of writing fresh when currentDraft is present', async () => {
    mockDraft('A clearer version of my own words.')

    const res = await postDraft({
      purpose: 'introduce',
      tone: 'direct',
      currentDraft: 'Hi, my name is Alex, a volunteer for Jane.',
    })

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data).toEqual({ draft: 'A clearer version of my own words.' })

    const call = jsonCompletion.mock.calls[0]?.[0]
    const systemPrompt = call.messages.find(
      (m: { role: string }) => m.role === 'system',
    )?.content
    expect(systemPrompt).toContain('polish')
    expect(systemPrompt).toContain(
      'Every concrete detail in the original MUST appear in your output',
    )
    const userPrompt = call.messages.find(
      (m: { role: string }) => m.role === 'user',
    )?.content
    expect(userPrompt).toContain('Hi, my name is Alex, a volunteer for Jane.')
    expect(userPrompt).toContain('Polish the script.')
    expect(userPrompt).not.toContain('Write the call script.')
  })

  it('instructs stripping voting-logistics brackets while preserving [your name]', async () => {
    mockDraft('A clearer version of my own words.')

    const res = await postDraft({
      purpose: 'vote-early',
      tone: 'direct',
      currentDraft:
        'Hi, my name is [your name]. Early voting runs ' +
        '[early voting dates] at [early voting location].',
    })

    expect(res.status).toBe(HttpStatus.CREATED)

    const call = jsonCompletion.mock.calls[0]?.[0]
    const systemPrompt = call.messages.find(
      (m: { role: string }) => m.role === 'system',
    )?.content
    expect(systemPrompt).toContain(
      'The literal "[your name]" placeholder in the volunteer opener MUST',
    )
    expect(systemPrompt).toContain('Strip any other bracketed placeholder')
    expect(systemPrompt).not.toContain(
      'and any bracketed placeholder. Dropping one',
    )
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

  it('rejects fresh generation for the custom purpose without calling the LLM', async () => {
    const res = await postDraft({ purpose: 'custom', tone: 'warm' })

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(jsonCompletion).not.toHaveBeenCalled()
  })

  it('rejects invalid input without calling the LLM', async () => {
    const badTone = await postDraft({ purpose: 'persuade', tone: 'sarcastic' })
    expect(badTone.status).toBe(HttpStatus.BAD_REQUEST)

    const badPurpose = await postDraft({
      purpose: 'world_domination',
      tone: 'warm',
    })
    expect(badPurpose.status).toBe(HttpStatus.BAD_REQUEST)

    expect(jsonCompletion).not.toHaveBeenCalled()
  })

  it('rejects an empty or oversized currentDraft without calling the LLM', async () => {
    const empty = await postDraft({
      purpose: 'introduce',
      tone: 'warm',
      currentDraft: '',
    })
    expect(empty.status).toBe(HttpStatus.BAD_REQUEST)

    const oversized = await postDraft({
      purpose: 'introduce',
      tone: 'warm',
      currentDraft: 'x'.repeat(2001),
    })
    expect(oversized.status).toBe(HttpStatus.BAD_REQUEST)

    expect(jsonCompletion).not.toHaveBeenCalled()
  })

  it('maps an LLM failure to 502', async () => {
    jsonCompletion.mockRejectedValue(new Error('model unavailable'))

    const res = await postDraft({ purpose: 'persuade', tone: 'urgent' })

    expect(res.status).toBe(HttpStatus.BAD_GATEWAY)
  })

  it('rejects a non-Pro campaign with a 400', async () => {
    await service.prisma.campaign.update({
      where: { id: campaign.id },
      data: { isPro: false },
    })

    const res = await postDraft({ purpose: 'introduce', tone: 'warm' })

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(jsonCompletion).not.toHaveBeenCalled()
  })

  it('allows an eo- (Serve) org without isPro', async () => {
    const eoSlug = 'eo-jane-doe'
    await service.prisma.organization.create({
      data: { slug: eoSlug, ownerId: service.user.id, positionId: 'pos-3' },
    })
    await service.prisma.campaign.create({
      data: {
        organizationSlug: eoSlug,
        userId: service.user.id,
        slug: 'jane-doe-eo',
        isPro: false,
        details: {},
        data: {},
        aiContent: {},
      },
    })
    mockDraft('An elected-official script.')

    const res = await service.client.post(
      '/v1/outreach/phone-banking/draft',
      { purpose: 'introduce', tone: 'warm' },
      { headers: { 'x-organization-slug': eoSlug } },
    )

    expect(res.status).toBe(HttpStatus.CREATED)
  })
})
