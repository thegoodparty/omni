import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { LlmService } from '@/llm/services/llm.service'
import {
  Campaign,
  ElectedOffice,
  OutreachStatus,
  OutreachType,
  PrioritySource,
  SocialAssetKind,
  SocialAssetPlatform,
} from '../../generated/prisma'
import { SERVE_SOCIAL_VOICE } from '../services/outreachSocialGeneration.service'
import { TONE_STYLES } from '../util/messageTone.util'

const service = useTestService()

const jsonCompletion = vi.fn()

let eoOrgSlug: string
let electedOffice: ElectedOffice

beforeEach(async () => {
  const llmSvc = service.app.get(LlmService)
  vi.spyOn(llmSvc, 'jsonCompletion').mockImplementation(jsonCompletion)

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  eoOrgSlug = `eo-${suffix}`

  await service.prisma.organization.create({
    data: { slug: eoOrgSlug, ownerId: service.user.id },
  })

  electedOffice = await service.prisma.electedOffice.create({
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
      expect(userPrompt).toContain('Office held')
      expect(userPrompt).not.toContain('Office sought')
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

    const call = jsonCompletion.mock.calls[0]?.[0]
    const systemPrompt = call.messages.find(
      (m: { role: string }) => m.role === 'system',
    )?.content
    const userPrompt = call.messages.find(
      (m: { role: string }) => m.role === 'user',
    )?.content

    expect(systemPrompt).toContain('elected official')
    expect(systemPrompt).not.toMatch(/candidate/i)
    expect(systemPrompt).not.toMatch(/voters?/i)
    expect(userPrompt).not.toMatch(/candidate/i)
    expect(userPrompt).not.toMatch(/voters?/i)
  })

  it('maps an LLM failure to 502', async () => {
    jsonCompletion.mockRejectedValue(new Error('model unavailable'))

    const res = await postDraft({ purpose: 'issue_update', tone: 'direct' })
    expect(res.status).toBe(HttpStatus.BAD_GATEWAY)
  })
})

describe('Public Profile grounding (ENG-10982)', () => {
  const mockDraftLlm = () => {
    jsonCompletion.mockResolvedValue({
      object: { draft: 'A grounded update.' },
      tokens: 50,
      inputTokens: 25,
      outputTokens: 25,
      model: 'claude-test',
    })
  }

  const draftUserPrompt = async () => {
    const res = await postDraft({ purpose: 'issue_update', tone: 'warm' })
    expect(res.status).toBe(HttpStatus.CREATED)
    const call = jsonCompletion.mock.calls[0]?.[0]
    return call.messages.find((m: { role: string }) => m.role === 'user')
      ?.content
  }

  const createPriority = (title: string, description: string) =>
    service.prisma.priority.create({
      data: {
        electedOfficeId: electedOffice.id,
        title,
        description,
        source: PrioritySource.user_stated,
      },
    })

  it('includes all five labeled blocks verbatim, priorities in sortOrder', async () => {
    mockDraftLlm()
    const profile = await service.prisma.personProfile.create({
      data: {
        personId: `person-${Date.now()}`,
        userId: service.user.id,
        bioOverride: 'I have lived here for 20 years.',
        whyRunning: 'I want to make sure every neighbor has a voice.',
        accomplishments: [
          {
            title: 'Balanced the budget',
            description: 'Cut waste without cutting services',
          },
          { title: 'Opened the new library' },
        ],
        recentExperience: [
          { title: 'City Council Member', organization: 'City of Fairview' },
          { title: 'Volunteer firefighter' },
        ],
      },
    })
    const housing = await createPriority(
      'Housing',
      'Build more affordable units',
    )
    const roads = await createPriority('Roads', 'Repave Main Street')
    await service.prisma.personProfileIssue.create({
      data: {
        personProfileId: profile.id,
        issueId: roads.id,
        visible: true,
        sortOrder: 1,
      },
    })
    await service.prisma.personProfileIssue.create({
      data: {
        personProfileId: profile.id,
        issueId: housing.id,
        visible: true,
        sortOrder: 0,
      },
    })

    const userPrompt = await draftUserPrompt()

    expect(userPrompt).toContain(
      [
        "The official's bio, in their own words:",
        '"""',
        'I have lived here for 20 years.',
        '"""',
      ].join('\n'),
    )
    expect(userPrompt).toContain(
      [
        'Why they serve, in their own words:',
        '"""',
        'I want to make sure every neighbor has a voice.',
        '"""',
      ].join('\n'),
    )
    expect(userPrompt).toContain(
      [
        "The official's accomplishments:",
        '- Balanced the budget: Cut waste without cutting services',
        '- Opened the new library',
      ].join('\n'),
    )
    expect(userPrompt).toContain(
      [
        "The official's recent experience:",
        '- City Council Member, City of Fairview',
        '- Volunteer firefighter',
      ].join('\n'),
    )
    expect(userPrompt).toContain(
      [
        "The official's published priorities:",
        '- Housing: Build more affordable units',
        '- Roads: Repave Main Street',
      ].join('\n'),
    )
  })

  it('excludes a hidden profile issue', async () => {
    mockDraftLlm()
    const profile = await service.prisma.personProfile.create({
      data: { personId: `person-${Date.now()}`, userId: service.user.id },
    })
    const hidden = await createPriority('Hidden issue', 'Should not appear')
    const visible = await createPriority('Visible issue', 'Should appear')
    await service.prisma.personProfileIssue.create({
      data: {
        personProfileId: profile.id,
        issueId: hidden.id,
        visible: false,
        sortOrder: 0,
      },
    })
    await service.prisma.personProfileIssue.create({
      data: {
        personProfileId: profile.id,
        issueId: visible.id,
        visible: true,
        sortOrder: 1,
      },
    })

    const userPrompt = await draftUserPrompt()

    expect(userPrompt).not.toContain('Hidden issue')
    expect(userPrompt).toContain('- Visible issue: Should appear')
  })

  it('degrades to the exact baseline prompt for an official with no PersonProfile row', async () => {
    mockDraftLlm()

    const userPrompt = await draftUserPrompt()

    expect(userPrompt).toBe(
      [
        `${SERVE_SOCIAL_VOICE.nameLabel}: Johnny Goodparty.`,
        `${SERVE_SOCIAL_VOICE.officeLabel}: local office.`,
        `Goal of this message: ${SERVE_SOCIAL_VOICE.purposeGoals.issue_update}.`,
        `Tone: ${TONE_STYLES.warm}`,
        'Write the draft message.',
      ].join('\n'),
    )
  })

  it('trims an over-cap bio to 2000 chars and caps priorities at 10', async () => {
    mockDraftLlm()
    const longBio = 'x'.repeat(2500)
    const profile = await service.prisma.personProfile.create({
      data: {
        personId: `person-${Date.now()}`,
        userId: service.user.id,
        bioOverride: longBio,
      },
    })
    for (let i = 0; i < 12; i++) {
      const priority = await createPriority(`Issue ${i}`, `Description ${i}`)
      await service.prisma.personProfileIssue.create({
        data: {
          personProfileId: profile.id,
          issueId: priority.id,
          visible: true,
          sortOrder: i,
        },
      })
    }

    const userPrompt = await draftUserPrompt()

    expect(userPrompt).toContain(`${'x'.repeat(1999)}…`)
    expect(userPrompt).not.toContain('x'.repeat(2001))
    for (let i = 0; i < 10; i++) {
      expect(userPrompt).toContain(`- Issue ${i}: Description ${i}`)
    }
    expect(userPrompt).not.toContain('- Issue 10:')
    expect(userPrompt).not.toContain('- Issue 11:')
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

  it('receives the same Public Profile context blocks as the draft path', async () => {
    await service.prisma.personProfile.create({
      data: {
        personId: `person-${Date.now()}`,
        userId: service.user.id,
        bioOverride: 'I have lived here for 20 years.',
      },
    })
    jsonCompletion.mockResolvedValue(
      llmResult([{ platform: 'facebook', text: 'FB adaptation' }]),
    )

    const res = await postGenerate({
      draftMessage: 'Join me for a town hall.',
      purpose: 'event_invite',
      platforms: ['facebook'],
    })

    expect(res.status).toBe(HttpStatus.CREATED)
    const call = jsonCompletion.mock.calls[0]?.[0]
    const userPrompt = call.messages.find(
      (m: { role: string }) => m.role === 'user',
    )?.content
    expect(userPrompt).toContain(
      [
        "The official's bio, in their own words:",
        '"""',
        'I have lived here for 20 years.',
        '"""',
      ].join('\n'),
    )
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

  it('hides Win rows from the serve list and detail when ONE org holds both a campaign and an elected office', async () => {
    // The post-election transition: the same org (and slug) gains an
    // ElectedOffice while its Win rows still carry that organizationSlug —
    // only the campaignId: null pin keeps them off the Serve surface.
    await service.prisma.electedOffice.create({
      data: { userId: service.user.id, organizationSlug: winOrgSlug },
    })
    const winRow = await service.prisma.outreach.create({
      data: {
        campaignId: winCampaign.id,
        organizationSlug: winOrgSlug,
        outreachType: OutreachType.socialMedia,
        status: OutreachStatus.completed,
        name: 'Win row',
      },
    })

    const serveList = await service.client.get(
      '/v1/outreach/serve',
      winHeaders(),
    )
    expect(serveList.status).toBe(HttpStatus.OK)
    expect(serveList.data).toEqual([])

    const winIdThroughServe = await service.client.get(
      `/v1/outreach/serve/${winRow.id}`,
      { ...winHeaders(), validateStatus: () => true },
    )
    expect(winIdThroughServe.status).toBe(HttpStatus.NOT_FOUND)
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
