import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { LlmService } from '@/llm/services/llm.service'
import {
  Campaign,
  OutreachStatus,
  OutreachType,
  Prisma,
  SocialAssetKind,
  SocialAssetPlatform,
} from '../../generated/prisma'

const service = useTestService()

const jsonCompletion = vi.fn()

let campaign: Campaign
let orgSlug: string

beforeEach(async () => {
  const llmSvc = service.app.get(LlmService)
  vi.spyOn(llmSvc, 'jsonCompletion').mockImplementation(jsonCompletion)

  const campaignId = 999
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
      details: { state: 'TX', zip: '78634', normalizedOffice: 'City Council' },
      data: {},
      aiContent: {},
    },
  })
})

const orgHeaders = () => ({ headers: { 'x-organization-slug': orgSlug } })

const llmResult = (
  assets: Array<{ platform: string; text: string; caption?: string }>,
) => ({
  object: { assets },
  tokens: 100,
  inputTokens: 50,
  outputTokens: 50,
  model: 'claude-test',
})

const postGenerate = (body: object) =>
  service.client.post('/v1/outreach/social/generate', body, orgHeaders())

const postSave = (body: object) =>
  service.client.post('/v1/outreach/social', body, orgHeaders())

const validSaveBody = () => ({
  name: 'Announce my campaign',
  purpose: 'introduce_myself',
  draftMessage: 'Hi, I am Jane and I am running for city council.',
  assets: [
    {
      platform: SocialAssetPlatform.facebook,
      kind: SocialAssetKind.post_copy,
      text: 'Facebook post copy',
    },
    {
      platform: SocialAssetPlatform.tiktok,
      kind: SocialAssetKind.video_script,
      text: 'TikTok video script',
      caption: 'TikTok caption',
    },
  ],
})

const countAllSocialRows = async () => ({
  outreach: await service.prisma.outreach.count(),
  social: await service.prisma.outreachSocial.count(),
  assets: await service.prisma.outreachSocialAsset.count(),
})

describe('POST /v1/outreach/social/draft', () => {
  const postDraft = (body: object) =>
    service.client.post('/v1/outreach/social/draft', body, orgHeaders())

  it('returns the generated draft and prompts with purpose, tone, and office', async () => {
    jsonCompletion.mockResolvedValue({
      object: { draft: 'A warm introduction from the candidate.' },
      tokens: 50,
      inputTokens: 25,
      outputTokens: 25,
      model: 'claude-test',
    })

    const res = await postDraft({ purpose: 'introduce_myself', tone: 'warm' })

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data).toEqual({
      draft: 'A warm introduction from the candidate.',
    })

    expect(jsonCompletion).toHaveBeenCalledTimes(1)
    const call = jsonCompletion.mock.calls[0]?.[0]
    expect(call.temperature).toBe(0.8)
    const userPrompt = call.messages.find(
      (m: { role: string }) => m.role === 'user',
    )?.content
    expect(userPrompt).toContain('introduce the candidate to voters')
    expect(userPrompt).toContain('Warm:')
    expect(userPrompt).toContain('City Council')
  })

  it('polishes the given text instead of writing fresh when currentDraft is present', async () => {
    jsonCompletion.mockResolvedValue({
      object: { draft: 'A clearer version of my own words.' },
      tokens: 50,
      inputTokens: 25,
      outputTokens: 25,
      model: 'claude-test',
    })

    const res = await postDraft({
      purpose: 'introduce_myself',
      tone: 'direct',
      currentDraft: 'Hi neighbors, I am Jane and I want your vote.',
    })

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data).toEqual({ draft: 'A clearer version of my own words.' })

    expect(jsonCompletion).toHaveBeenCalledTimes(1)
    const call = jsonCompletion.mock.calls[0]?.[0]
    const systemPrompt = call.messages.find(
      (m: { role: string }) => m.role === 'system',
    )?.content
    expect(systemPrompt).toContain('polish')
    expect(systemPrompt).toContain(
      "Keep the author's meaning, structure, and every factual claim",
    )
    const userPrompt = call.messages.find(
      (m: { role: string }) => m.role === 'user',
    )?.content
    expect(userPrompt).toContain(
      'Hi neighbors, I am Jane and I want your vote.',
    )
    expect(userPrompt).toContain('Polish the message.')
    expect(userPrompt).toContain('Direct:')
    expect(userPrompt).not.toContain('Write the draft message.')
  })

  it('allows improve mode for the custom purpose', async () => {
    jsonCompletion.mockResolvedValue({
      object: { draft: 'Polished custom words.' },
      tokens: 50,
      inputTokens: 25,
      outputTokens: 25,
      model: 'claude-test',
    })

    const res = await postDraft({
      purpose: 'custom',
      tone: 'warm',
      currentDraft: 'Entirely my words, roughly phrased.',
    })

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data).toEqual({ draft: 'Polished custom words.' })
  })

  it('rejects an empty or oversized currentDraft without calling the LLM', async () => {
    const empty = await postDraft({
      purpose: 'introduce_myself',
      tone: 'warm',
      currentDraft: '',
    })
    expect(empty.status).toBe(HttpStatus.BAD_REQUEST)

    const oversized = await postDraft({
      purpose: 'introduce_myself',
      tone: 'warm',
      currentDraft: 'x'.repeat(2001),
    })
    expect(oversized.status).toBe(HttpStatus.BAD_REQUEST)

    expect(jsonCompletion).not.toHaveBeenCalled()
  })

  it('maps an LLM failure to 502', async () => {
    jsonCompletion.mockRejectedValue(new Error('model unavailable'))

    const res = await postDraft({ purpose: 'persuade_voters', tone: 'urgent' })

    expect(res.status).toBe(HttpStatus.BAD_GATEWAY)
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

    const customPurpose = await postDraft({ purpose: 'custom', tone: 'warm' })
    expect(customPurpose.status).toBe(HttpStatus.BAD_REQUEST)

    expect(jsonCompletion).not.toHaveBeenCalled()
  })
})

describe('POST /v1/outreach/social/generate', () => {
  it('returns one asset per platform with server-derived kinds', async () => {
    jsonCompletion.mockResolvedValue(
      llmResult([
        { platform: 'facebook', text: 'FB adaptation' },
        { platform: 'x', text: 'Short X post' },
        { platform: 'tiktok', text: 'Spoken script', caption: 'A caption' },
      ]),
    )

    const res = await postGenerate({
      draftMessage: 'Vote for me on election day.',
      purpose: 'election_day_turnout',
      platforms: ['facebook', 'x', 'tiktok'],
    })

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.assets).toEqual([
      {
        platform: 'facebook',
        kind: 'post_copy',
        text: 'FB adaptation',
        caption: null,
      },
      { platform: 'x', kind: 'post_copy', text: 'Short X post', caption: null },
      {
        platform: 'tiktok',
        kind: 'video_script',
        text: 'Spoken script',
        caption: 'A caption',
      },
    ])

    expect(await countAllSocialRows()).toEqual({
      outreach: 0,
      social: 0,
      assets: 0,
    })
  })

  it('dedupes repeated platforms before calling the LLM', async () => {
    jsonCompletion.mockResolvedValue(
      llmResult([{ platform: 'facebook', text: 'FB adaptation' }]),
    )

    const res = await postGenerate({
      draftMessage: 'Vote for me.',
      purpose: 'persuade_voters',
      platforms: ['facebook', 'facebook'],
    })

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.assets).toHaveLength(1)
    expect(jsonCompletion).toHaveBeenCalledTimes(1)
  })

  it('rejects an LLM response missing a requested platform', async () => {
    jsonCompletion.mockResolvedValue(
      llmResult([{ platform: 'facebook', text: 'FB adaptation' }]),
    )

    const res = await postGenerate({
      draftMessage: 'Vote for me.',
      purpose: 'persuade_voters',
      platforms: ['facebook', 'nextdoor'],
    })

    expect(res.status).toBe(HttpStatus.BAD_GATEWAY)
  })

  it('rejects a video asset that arrives without a caption', async () => {
    jsonCompletion.mockResolvedValue(
      llmResult([{ platform: 'youtube_shorts', text: 'Script only' }]),
    )

    const res = await postGenerate({
      draftMessage: 'Vote for me.',
      purpose: 'persuade_voters',
      platforms: ['youtube_shorts'],
    })

    expect(res.status).toBe(HttpStatus.BAD_GATEWAY)
  })

  it('maps an LLM failure to 502', async () => {
    jsonCompletion.mockRejectedValue(new Error('model unavailable'))

    const res = await postGenerate({
      draftMessage: 'Vote for me.',
      purpose: 'persuade_voters',
      platforms: ['facebook'],
    })

    expect(res.status).toBe(HttpStatus.BAD_GATEWAY)
  })

  it('rejects invalid input without calling the LLM', async () => {
    const emptyPlatforms = await postGenerate({
      draftMessage: 'Vote for me.',
      purpose: 'persuade_voters',
      platforms: [],
    })
    expect(emptyPlatforms.status).toBe(HttpStatus.BAD_REQUEST)

    const badPurpose = await postGenerate({
      draftMessage: 'Vote for me.',
      purpose: 'world_domination',
      platforms: ['facebook'],
    })
    expect(badPurpose.status).toBe(HttpStatus.BAD_REQUEST)

    const oversizedDraft = await postGenerate({
      draftMessage: 'x'.repeat(2001),
      purpose: 'persuade_voters',
      platforms: ['facebook'],
    })
    expect(oversizedDraft.status).toBe(HttpStatus.BAD_REQUEST)

    expect(jsonCompletion).not.toHaveBeenCalled()
  })
})

describe('POST /v1/outreach/social', () => {
  it('persists spine, satellite, and assets in one save', async () => {
    const res = await postSave(validSaveBody())

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data).toMatchObject({
      campaignId: campaign.id,
      organizationSlug: orgSlug,
      outreachType: OutreachType.socialMedia,
      status: OutreachStatus.completed,
      name: 'Announce my campaign',
      social: {
        purpose: 'introduce_myself',
        draftMessage: 'Hi, I am Jane and I am running for city council.',
      },
    })
    expect(res.data.social.assets).toHaveLength(2)

    const spine = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: res.data.id },
      include: { social: { include: { assets: true } } },
    })
    expect(spine.outreachType).toBe(OutreachType.socialMedia)
    expect(spine.status).toBe(OutreachStatus.completed)
    expect(spine.social?.purpose).toBe('introduce_myself')
    expect(spine.social?.assets).toHaveLength(2)
  })

  it('derives kind from platform and drops captions on copy assets', async () => {
    const res = await postSave({
      ...validSaveBody(),
      assets: [
        {
          platform: SocialAssetPlatform.tiktok,
          kind: SocialAssetKind.post_copy,
          text: 'Script',
          caption: 'Caption',
        },
        {
          platform: SocialAssetPlatform.facebook,
          kind: SocialAssetKind.video_script,
          text: 'Copy',
          caption: 'Should be dropped',
        },
      ],
    })

    expect(res.status).toBe(HttpStatus.CREATED)
    const assets = await service.prisma.outreachSocialAsset.findMany({
      orderBy: { platform: Prisma.SortOrder.asc },
    })
    expect(assets).toMatchObject([
      {
        platform: SocialAssetPlatform.facebook,
        kind: SocialAssetKind.post_copy,
        caption: null,
      },
      {
        platform: SocialAssetPlatform.tiktok,
        kind: SocialAssetKind.video_script,
        caption: 'Caption',
      },
    ])
  })

  it('rejects duplicate-platform assets and persists nothing', async () => {
    const body = validSaveBody()
    const res = await postSave({
      ...body,
      assets: [body.assets[0], body.assets[0]],
    })

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(await countAllSocialRows()).toEqual({
      outreach: 0,
      social: 0,
      assets: 0,
    })
  })

  it('rejects an asset for an unknown platform', async () => {
    const body = validSaveBody()
    const res = await postSave({
      ...body,
      assets: [
        {
          platform: 'linkedin',
          kind: SocialAssetKind.post_copy,
          text: 'Copy',
        },
      ],
    })

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(await countAllSocialRows()).toEqual({
      outreach: 0,
      social: 0,
      assets: 0,
    })
  })
})

describe('GET /v1/outreach/:id', () => {
  it('returns the spine row with its social assets', async () => {
    const saved = await postSave(validSaveBody())

    const res = await service.client.get(
      `/v1/outreach/${saved.data.id}`,
      orgHeaders(),
    )

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.id).toBe(saved.data.id)
    expect(res.data.outreachType).toBe(OutreachType.socialMedia)
    expect(res.data.social.assets).toMatchObject([
      { platform: SocialAssetPlatform.facebook, caption: null },
      { platform: SocialAssetPlatform.tiktok, caption: 'TikTok caption' },
    ])
  })

  it('returns a legacy row without a social section', async () => {
    const legacy = await service.prisma.outreach.create({
      data: {
        campaignId: campaign.id,
        organizationSlug: orgSlug,
        outreachType: OutreachType.text,
        script: 'Vote for me.',
      },
    })

    const res = await service.client.get(
      `/v1/outreach/${legacy.id}`,
      orgHeaders(),
    )

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.id).toBe(legacy.id)
    expect(res.data).not.toHaveProperty('social')
  })

  it("404s on another campaign's row and on a missing id", async () => {
    const otherUser = await service.prisma.user.create({
      data: { email: 'other@goodparty.org', clerkId: 'user_other_456' },
    })
    await service.prisma.organization.create({
      data: { slug: 'other-org', ownerId: otherUser.id, positionId: 'pos-2' },
    })
    const otherCampaign = await service.prisma.campaign.create({
      data: {
        organizationSlug: 'other-org',
        userId: otherUser.id,
        slug: 'john-doe',
        details: {},
        data: {},
        aiContent: {},
      },
    })
    const foreign = await service.prisma.outreach.create({
      data: {
        campaignId: otherCampaign.id,
        organizationSlug: 'other-org',
        outreachType: OutreachType.socialMedia,
        status: OutreachStatus.completed,
      },
    })

    const foreignRes = await service.client.get(
      `/v1/outreach/${foreign.id}`,
      orgHeaders(),
    )
    expect(foreignRes.status).toBe(HttpStatus.NOT_FOUND)

    const missingRes = await service.client.get(
      '/v1/outreach/999999',
      orgHeaders(),
    )
    expect(missingRes.status).toBe(HttpStatus.NOT_FOUND)
  })
})
