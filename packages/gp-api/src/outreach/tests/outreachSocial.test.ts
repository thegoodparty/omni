import { randomUUID } from 'node:crypto'
import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Person } from '@goodparty_org/contracts'
import { useTestService } from '@/test-service'
import { LlmService } from '@/llm/services/llm.service'
import { VoterQueryService } from '@/peopleDb/services/voterQuery.service'
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

    jsonCompletion.mockResolvedValue({
      object: { draft: 'A grounded draft.' },
      tokens: 50,
      inputTokens: 25,
      outputTokens: 25,
      model: 'claude-test',
    })

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
      'Every concrete detail in the original MUST appear in your output',
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

  it('rejects a kind that does not match its platform', async () => {
    // The schema derives kind from platform: a mismatched client kind is a
    // 400 (previously it was silently corrected, which let a post_copy
    // platform dodge the shorter length cap by claiming video_script).
    const res = await postSave({
      ...validSaveBody(),
      assets: [
        {
          platform: SocialAssetPlatform.facebook,
          kind: SocialAssetKind.video_script,
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

  it('rejects post copy over the copy cap even when labeled video_script', async () => {
    const res = await postSave({
      ...validSaveBody(),
      assets: [
        {
          platform: SocialAssetPlatform.facebook,
          kind: SocialAssetKind.video_script,
          text: 'x'.repeat(5000),
        },
      ],
    })

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('drops captions on copy assets', async () => {
    const res = await postSave({
      ...validSaveBody(),
      assets: [
        {
          platform: SocialAssetPlatform.facebook,
          kind: SocialAssetKind.post_copy,
          text: 'Copy',
          caption: 'Should be dropped',
        },
        {
          platform: SocialAssetPlatform.tiktok,
          kind: SocialAssetKind.video_script,
          text: 'Script',
          caption: 'Caption',
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

describe('GET /v1/outreach/:id — nativePhoneBanking', () => {
  const DISTRICT_ID = '457a1cd7-4184-f823-49d3-f207af693521'
  const PEOPLE_PAGINATION = {
    totalResults: 0,
    currentPage: 1,
    pageSize: 1000,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  }

  const fakePerson = (overrides: Partial<Person> = {}): Person => ({
    id: randomUUID(),
    lalVoterId: `LAL-${randomUUID()}`,
    firstName: 'Jane',
    middleName: null,
    lastName: 'Voter',
    nameSuffix: null,
    age: 42,
    state: 'WY',
    address: {
      line1: '123 Main St',
      line2: null,
      city: 'Cheyenne',
      state: 'WY',
      zip: '82001',
      zipPlus4: null,
      latitude: null,
      longitude: null,
    },
    cellPhone: '3075550001',
    landline: null,
    gender: null,
    politicalParty: 'Independent',
    registeredVoter: 'Yes',
    estimatedIncomeAmount: null,
    voterStatus: null,
    maritalStatus: null,
    hasChildrenUnder18: null,
    veteranStatus: null,
    homeowner: null,
    businessOwner: null,
    levelOfEducation: null,
    ethnicityGroup: null,
    language: 'English',
    ...overrides,
  })

  let pbOrgSlug: string
  let pbCampaign: Campaign

  beforeEach(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    pbOrgSlug = `campaign-pbdetail-${suffix}`
    await service.prisma.organization.create({
      data: {
        slug: pbOrgSlug,
        ownerId: service.user.id,
        overrideDistrictId: DISTRICT_ID,
      },
    })
    pbCampaign = await service.prisma.campaign.create({
      data: {
        userId: service.user.id,
        slug: `pbdetail-campaign-${suffix}`,
        organizationSlug: pbOrgSlug,
        isPro: true,
      },
    })
  })

  const pbOrgHeaders = () => ({
    headers: { 'x-organization-slug': pbOrgSlug },
  })

  // A one-person entry and a two-person (household) entry sharing a phone,
  // so the fan-out math and the single-person math both land in the same
  // list.
  const buildList = async () => {
    const filter = await service.prisma.voterFileFilter.create({
      data: { organizationSlug: pbOrgSlug, name: 'PB detail audience' },
    })
    vi.spyOn(
      service.app.get(VoterQueryService),
      'findPeople',
    ).mockResolvedValue({
      pagination: PEOPLE_PAGINATION,
      people: [
        fakePerson({ id: randomUUID(), cellPhone: '3075552000' }),
        fakePerson({ id: randomUUID(), cellPhone: '3075552001' }),
        fakePerson({ id: randomUUID(), cellPhone: '3075552001' }),
      ],
    })
    const res = await service.client.post(
      '/v1/phone-banking/lists',
      {
        name: 'Tuesday calls',
        script: 'Hi, this is a volunteer calling about the election.',
        sheetCount: 1,
        voterFileFilterId: filter.id,
        purpose: 'introduce',
      },
      pbOrgHeaders(),
    )
    expect(res.status).toBe(HttpStatus.CREATED)
    const entries = await service.prisma.phoneBankingListEntry.findMany({
      where: { phoneBankingListId: res.data.id },
      include: { persons: true },
      orderBy: { seq: Prisma.SortOrder.asc },
    })
    return { listId: res.data.id, outreachId: res.data.outreachId, entries }
  }

  const postCall = (listId: number, body: Record<string, unknown>) =>
    service.client.post(
      `/v1/phone-banking/lists/${listId}/calls`,
      body,
      pbOrgHeaders(),
    )

  it('reports entry/people progress, byOutcome, and supporters after an answered-with-support log and a no_answer household fan-out', async () => {
    const { outreachId, entries } = await buildList()
    const [soloEntry, householdEntry] = entries
    expect(soloEntry?.persons).toHaveLength(1)
    expect(householdEntry?.persons).toHaveLength(2)

    const answered = await postCall(soloEntry!.phoneBankingListId, {
      entryId: soloEntry!.id,
      outcome: 'answered',
      personId: soloEntry!.persons[0]!.personId,
      supportAnswer: 'supporter',
    })
    expect(answered.status).toBe(HttpStatus.CREATED)

    const noAnswer = await postCall(householdEntry!.phoneBankingListId, {
      entryId: householdEntry!.id,
      outcome: 'no_answer',
    })
    expect(noAnswer.status).toBe(HttpStatus.CREATED)

    const res = await service.client.get(
      `/v1/outreach/${outreachId}`,
      pbOrgHeaders(),
    )

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.phoneBanking).toEqual({
      listId: soloEntry!.phoneBankingListId,
      entriesTotal: 2,
      entriesCalled: 2,
      peopleTotal: 3,
      peopleCalled: 3,
      byOutcome: {
        answered: 1,
        no_answer: 1,
        voicemail: 0,
        wrong_number: 0,
        refused: 0,
      },
      supporters: 1,
    })
  })

  it('rolls an entry up to its most recent call when a housemate is corrected individually after a fan-out', async () => {
    const { outreachId, entries } = await buildList()
    const [, householdEntry] = entries
    expect(householdEntry?.persons).toHaveLength(2)
    const [personA, personB] = householdEntry!.persons

    // Fan-out: both housemates land on no_answer with the same occurredAt.
    const fanOut = await postCall(householdEntry!.phoneBankingListId, {
      entryId: householdEntry!.id,
      outcome: 'no_answer',
    })
    expect(fanOut.status).toBe(HttpStatus.CREATED)

    // A later, separate call reaches just personA — the entry's two rows
    // now genuinely diverge in both outcome and occurredAt.
    const correction = await postCall(householdEntry!.phoneBankingListId, {
      entryId: householdEntry!.id,
      outcome: 'answered',
      personId: personA!.personId,
    })
    expect(correction.status).toBe(HttpStatus.CREATED)

    const rows = await service.prisma.contactInteractionPhoneBanking.findMany({
      where: { phoneBankingListId: householdEntry!.phoneBankingListId },
    })
    const rowFor = (personId: string) =>
      rows.find((row) => row.personId === personId)
    expect(rowFor(personA!.personId)?.outcome).toBe('answered')
    expect(rowFor(personB!.personId)?.outcome).toBe('no_answer')
    expect(rowFor(personA!.personId)!.occurredAt.getTime()).toBeGreaterThan(
      rowFor(personB!.personId)!.occurredAt.getTime(),
    )

    const res = await service.client.get(
      `/v1/outreach/${outreachId}`,
      pbOrgHeaders(),
    )

    expect(res.status).toBe(HttpStatus.OK)
    // The household entry's rolled-up outcome must follow its most recent
    // call (personA's answered), not personB's earlier no_answer.
    expect(res.data.phoneBanking.entriesCalled).toBe(1)
    expect(res.data.phoneBanking.byOutcome).toMatchObject({
      answered: 1,
      no_answer: 0,
    })
  })

  it('returns no phoneBanking block for a legacy phoneBanking outreach row', async () => {
    const legacy = await service.prisma.outreach.create({
      data: {
        campaignId: pbCampaign.id,
        organizationSlug: pbOrgSlug,
        outreachType: OutreachType.phoneBanking,
        status: OutreachStatus.completed,
      },
    })

    const res = await service.client.get(
      `/v1/outreach/${legacy.id}`,
      pbOrgHeaders(),
    )

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data).not.toHaveProperty('phoneBanking')
  })
})
