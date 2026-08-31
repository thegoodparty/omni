import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { LlmService } from '@/llm/services/llm.service'
import {
  Campaign,
  OutreachStatus,
  OutreachType,
  SocialAssetKind,
  SocialAssetPlatform,
} from '../../generated/prisma'

const service = useTestService()

const jsonCompletion = vi.fn()

let eoOrgSlug: string

beforeEach(async () => {
  const llmSvc = service.app.get(LlmService)
  vi.spyOn(llmSvc, 'jsonCompletion').mockImplementation(jsonCompletion)

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  eoOrgSlug = `eo-${suffix}`

  await service.prisma.organization.create({
    data: { slug: eoOrgSlug, ownerId: service.user.id },
  })

  await service.prisma.electedOffice.create({
    data: { userId: service.user.id, organizationSlug: eoOrgSlug },
  })
})

const eoHeaders = (slug = eoOrgSlug) => ({
  headers: { 'x-organization-slug': slug },
})

const llmResult = (
  assets: Array<{ platform: string; text: string; caption?: string }>,
) => ({
  object: { assets },
  tokens: 100,
  inputTokens: 50,
  outputTokens: 50,
  model: 'claude-test',
})

const postDraft = (body: object, headers = eoHeaders()) =>
  service.client.post('/v1/outreach/serve/social/draft', body, headers)

const postGenerate = (body: object, headers = eoHeaders()) =>
  service.client.post('/v1/outreach/serve/social/generate', body, headers)

const postSave = (body: object, headers = eoHeaders()) =>
  service.client.post('/v1/outreach/serve/social', body, headers)

const validSaveBody = (overrides: object = {}) => ({
  name: 'Town hall announcement',
  purpose: 'event_invite',
  draftMessage: 'Join me for a town hall next week.',
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
  ...overrides,
})

const countAllSocialRows = async () => ({
  outreach: await service.prisma.outreach.count(),
  social: await service.prisma.outreachSocial.count(),
  assets: await service.prisma.outreachSocialAsset.count(),
})

describe('POST /v1/outreach/serve/social/draft', () => {
  it('drafts for each serve purpose with the serve goal + system prompt, never candidate/voter framing', async () => {
    const goals: Record<string, string> = {
      introduce_myself:
        'introduce the elected official to the constituents they serve',
      explain_decision:
        'explain a recent decision or vote and the reasoning behind it',
      event_invite: 'invite constituents to a town hall or local event',
      community_input:
        'invite constituents to share input on a local issue or upcoming decision',
      share_resource:
        'announce a local program, service, or resource available to constituents',
      issue_update:
        'share a progress update on a local issue the official is working on',
    }

    for (const [purpose, goal] of Object.entries(goals)) {
      jsonCompletion.mockClear()
      jsonCompletion.mockResolvedValue({
        object: { draft: 'A constituent update.' },
        tokens: 50,
        inputTokens: 25,
        outputTokens: 25,
        model: 'claude-test',
      })

      const res = await postDraft({ purpose, tone: 'warm' })

      expect(res.status).toBe(HttpStatus.CREATED)
      const call = jsonCompletion.mock.calls[0]?.[0]
      const systemPrompt = call.messages.find(
        (m: { role: string }) => m.role === 'system',
      )?.content
      const userPrompt = call.messages.find(
        (m: { role: string }) => m.role === 'user',
      )?.content

      expect(userPrompt).toContain(goal)
      expect(systemPrompt).toContain('elected official')
      expect(systemPrompt).not.toMatch(/candidate/i)
      expect(systemPrompt).not.toMatch(/voters?/i)
      expect(userPrompt).not.toMatch(/candidate/i)
      expect(userPrompt).not.toMatch(/voters?/i)
    }
  })

  it('rejects a Win-only purpose slug', async () => {
    const res = await postDraft({ purpose: 'persuade_voters', tone: 'warm' })
    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(jsonCompletion).not.toHaveBeenCalled()
  })

  it('404s for an organization with no elected office', async () => {
    const bareOrg = await service.prisma.organization.create({
      data: { slug: `eo-bare-${Date.now()}`, ownerId: service.user.id },
    })

    const res = await postDraft(
      { purpose: 'event_invite', tone: 'warm' },
      eoHeaders(bareOrg.slug),
    )
    expect(res.status).toBe(HttpStatus.NOT_FOUND)
    expect(jsonCompletion).not.toHaveBeenCalled()
  })

  it('400s for custom without currentDraft, and runs the improve path with one', async () => {
    const noDraft = await postDraft({ purpose: 'custom', tone: 'warm' })
    expect(noDraft.status).toBe(HttpStatus.BAD_REQUEST)
    expect(jsonCompletion).not.toHaveBeenCalled()

    jsonCompletion.mockResolvedValue({
      object: { draft: 'Polished words.' },
      tokens: 50,
      inputTokens: 25,
      outputTokens: 25,
      model: 'claude-test',
    })
    const withDraft = await postDraft({
      purpose: 'custom',
      tone: 'warm',
      currentDraft: 'My own words about the pothole program.',
    })
    expect(withDraft.status).toBe(HttpStatus.CREATED)
    expect(withDraft.data).toEqual({ draft: 'Polished words.' })
  })

  it('maps an LLM failure to 502', async () => {
    jsonCompletion.mockRejectedValue(new Error('model unavailable'))

    const res = await postDraft({ purpose: 'issue_update', tone: 'direct' })
    expect(res.status).toBe(HttpStatus.BAD_GATEWAY)
  })
})

describe('POST /v1/outreach/serve/social/generate', () => {
  it('returns platform assets for a serve org', async () => {
    jsonCompletion.mockResolvedValue(
      llmResult([{ platform: 'facebook', text: 'FB adaptation' }]),
    )

    const res = await postGenerate({
      draftMessage: 'Join me for a town hall.',
      purpose: 'event_invite',
      platforms: ['facebook'],
    })

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.assets).toEqual([
      {
        platform: 'facebook',
        kind: 'post_copy',
        text: 'FB adaptation',
        caption: null,
      },
    ])
  })

  it('404s for an organization with no elected office', async () => {
    const bareOrg = await service.prisma.organization.create({
      data: { slug: `eo-bare-${Date.now()}`, ownerId: service.user.id },
    })

    const res = await postGenerate(
      {
        draftMessage: 'Join me.',
        purpose: 'event_invite',
        platforms: ['facebook'],
      },
      eoHeaders(bareOrg.slug),
    )
    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })
})

describe('POST /v1/outreach/serve/social', () => {
  it('persists spine + satellite + assets atomically with campaignId null and the org slug', async () => {
    const res = await postSave(validSaveBody())

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data).toMatchObject({
      campaignId: null,
      organizationSlug: eoOrgSlug,
      outreachType: OutreachType.socialMedia,
      status: OutreachStatus.completed,
      name: 'Town hall announcement',
      social: {
        purpose: 'event_invite',
        draftMessage: 'Join me for a town hall next week.',
      },
    })
    expect(res.data.social.assets).toHaveLength(2)

    const spine = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: res.data.id },
      include: { social: { include: { assets: true } } },
    })
    expect(spine.campaignId).toBeNull()
    expect(spine.organizationSlug).toBe(eoOrgSlug)
    expect(spine.social?.assets).toHaveLength(2)
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

  it('404s for an organization with no elected office', async () => {
    const bareOrg = await service.prisma.organization.create({
      data: { slug: `eo-bare-${Date.now()}`, ownerId: service.user.id },
    })

    const res = await postSave(validSaveBody(), eoHeaders(bareOrg.slug))
    expect(res.status).toBe(HttpStatus.NOT_FOUND)
    expect(await countAllSocialRows()).toEqual({
      outreach: 0,
      social: 0,
      assets: 0,
    })
  })
})

describe('Win/Serve isolation (list + detail)', () => {
  let winOrgSlug: string
  let winCampaign: Campaign

  beforeEach(async () => {
    const campaignId = 88_001
    winOrgSlug = `campaign-${campaignId}`
    await service.prisma.organization.create({
      data: { slug: winOrgSlug, ownerId: service.user.id },
    })
    winCampaign = await service.prisma.campaign.create({
      data: {
        id: campaignId,
        organizationSlug: winOrgSlug,
        userId: service.user.id,
        slug: 'jane-doe',
        details: {},
        data: {},
        aiContent: {},
      },
    })
  })

  const winHeaders = () => ({ headers: { 'x-organization-slug': winOrgSlug } })

  it('gives a user with both a Win campaign and a Serve org fully disjoint lists', async () => {
    const winRow = await service.prisma.outreach.create({
      data: {
        campaignId: winCampaign.id,
        organizationSlug: winOrgSlug,
        outreachType: OutreachType.socialMedia,
        status: OutreachStatus.completed,
        name: 'Win row',
      },
    })
    const serveSave = await postSave(validSaveBody())
    expect(serveSave.status).toBe(HttpStatus.CREATED)

    const winList = await service.client.get('/v1/outreach', winHeaders())
    expect(winList.status).toBe(HttpStatus.OK)
    expect(winList.data.map((row: { id: number }) => row.id)).toEqual([
      winRow.id,
    ])

    const serveList = await service.client.get(
      '/v1/outreach/serve',
      eoHeaders(),
    )
    expect(serveList.status).toBe(HttpStatus.OK)
    expect(serveList.data.map((row: { id: number }) => row.id)).toEqual([
      serveSave.data.id,
    ])
  })

  it('never mutates an existing Win row on a serve save', async () => {
    const winRow = await service.prisma.outreach.create({
      data: {
        campaignId: winCampaign.id,
        organizationSlug: winOrgSlug,
        outreachType: OutreachType.socialMedia,
        status: OutreachStatus.completed,
        name: 'Win row',
      },
    })

    await postSave(validSaveBody())

    const winCountAfter = await service.prisma.outreach.count({
      where: { campaignId: winCampaign.id },
    })
    expect(winCountAfter).toBe(1)

    const winRowAfter = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: winRow.id },
    })
    expect(winRowAfter).toEqual(winRow)
  })

  it('404s a Win row id through the serve detail route, and vice versa', async () => {
    const winRow = await service.prisma.outreach.create({
      data: {
        campaignId: winCampaign.id,
        organizationSlug: winOrgSlug,
        outreachType: OutreachType.socialMedia,
        status: OutreachStatus.completed,
        name: 'Win row',
      },
    })
    const serveSave = await postSave(validSaveBody())

    const winIdThroughServe = await service.client.get(
      `/v1/outreach/serve/${winRow.id}`,
      { ...eoHeaders(), validateStatus: () => true },
    )
    expect(winIdThroughServe.status).toBe(HttpStatus.NOT_FOUND)

    const serveIdThroughWin = await service.client.get(
      `/v1/outreach/${serveSave.data.id}`,
      { ...winHeaders(), validateStatus: () => true },
    )
    expect(serveIdThroughWin.status).toBe(HttpStatus.NOT_FOUND)
  })

  it('archives a serve row via the shared archive route, and cannot touch a Win row through the serve org slug', async () => {
    const serveSave = await postSave(validSaveBody())
    const winRow = await service.prisma.outreach.create({
      data: {
        campaignId: winCampaign.id,
        organizationSlug: winOrgSlug,
        outreachType: OutreachType.socialMedia,
        status: OutreachStatus.completed,
        name: 'Win row',
      },
    })

    const archiveRes = await service.client.patch(
      `/v1/outreach/${serveSave.data.id}/archive`,
      { archived: true },
      eoHeaders(),
    )
    expect(archiveRes.status).toBe(HttpStatus.OK)
    expect(archiveRes.data.archivedAt).not.toBeNull()

    const restoreRes = await service.client.patch(
      `/v1/outreach/${serveSave.data.id}/archive`,
      { archived: false },
      eoHeaders(),
    )
    expect(restoreRes.status).toBe(HttpStatus.OK)
    expect(restoreRes.data.archivedAt).toBeNull()

    const winArchiveAttempt = await service.client.patch(
      `/v1/outreach/${winRow.id}/archive`,
      { archived: true },
      { ...eoHeaders(), validateStatus: () => true },
    )
    expect(winArchiveAttempt.status).toBe(HttpStatus.NOT_FOUND)
    const winRowAfter = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: winRow.id },
    })
    expect(winRowAfter.archivedAt).toBeNull()
  })
})
