import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FeaturesService } from '@/features/services/features.service'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { useTestService } from '@/test-service'
import { OutreachService } from './services/outreach.service'
import { OutreachServeComposeContextService } from './services/outreachServeComposeContext.service'
import { OutreachServeSmsCreateService } from './services/outreachServeSmsCreate.service'
import { OutreachSmsGenerationService } from './services/outreachSmsGeneration.service'
import { OutreachSmsRepliesService } from './services/outreachSmsReplies.service'
import { SERVE_SMS_VOICE } from './util/serveSmsVoice.util'

// Driven over HTTP rather than by instantiating the controller: B1 registered
// OutreachServeSmsController in OutreachModule, so the routes exist and the
// harness can exercise what direct instantiation skips — the
// @UseElectedOffice() guard binding, ZodValidationPipe body parsing,
// @ResponseSchema response validation and route resolution. docs/testing.md
// requires this for anything behind an HTTP route.
const service = useTestService()

let eoOrgSlug: string

const generateDraftWithVoice = vi.fn()
const buildProfileContext = vi.fn()
const createDraft = vi.fn()
const getSmsResults = vi.fn()
const listReplies = vi.fn()
const isFeatureEnabled = vi.fn()

const stub = <T>(token: new (...args: never[]) => T): T =>
  service.app.get(token)

beforeEach(async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  eoOrgSlug = `eo-${suffix}`

  await service.prisma.organization.create({
    data: { slug: eoOrgSlug, ownerId: service.user.id },
  })
  await service.prisma.electedOffice.create({
    data: { userId: service.user.id, organizationSlug: eoOrgSlug },
  })

  generateDraftWithVoice.mockReset().mockResolvedValue('draft body')
  buildProfileContext
    .mockReset()
    .mockResolvedValue(["The official's bio, in their own words:"])
  createDraft.mockReset().mockResolvedValue({
    outreachId: 12,
    recipientCount: 480,
    excludedOptedOutCount: 3,
    excludedDuplicateCount: 7,
  })
  getSmsResults
    .mockReset()
    .mockResolvedValue({ contacts: 480, responded: 61, optedOut: 4 })
  listReplies.mockReset().mockResolvedValue({ total: 0, replies: [] })
  isFeatureEnabled.mockReset().mockResolvedValue(true)

  vi.spyOn(
    stub(OutreachSmsGenerationService),
    'generateDraftWithVoice',
  ).mockImplementation(generateDraftWithVoice)
  vi.spyOn(
    stub(OutreachServeComposeContextService),
    'buildProfileContext',
  ).mockImplementation(buildProfileContext)
  vi.spyOn(
    stub(OutreachServeSmsCreateService),
    'createDraft',
  ).mockImplementation(createDraft)
  vi.spyOn(stub(OutreachService), 'getSmsResults').mockImplementation(
    getSmsResults,
  )
  vi.spyOn(stub(OutreachSmsRepliesService), 'listReplies').mockImplementation(
    listReplies,
  )
  vi.spyOn(stub(FeaturesService), 'isFeatureEnabled').mockImplementation(
    isFeatureEnabled,
  )

  // Office and place are prompt enrichment. Stubbed per test rather than
  // globally where a test needs the failure branch.
  vi.spyOn(
    stub(OrganizationsService),
    'resolvePositionNameByOrganizationSlug',
  ).mockResolvedValue('City Council')
  vi.spyOn(
    stub(OrganizationsService),
    'getDistrictForOrgSlug',
  ).mockResolvedValue({ l2Name: 'Austin City', state: 'TX' } as Awaited<
    ReturnType<OrganizationsService['getDistrictForOrgSlug']>
  >)
  vi.spyOn(OrganizationsService, 'extractCityFromDistrictName').mockReturnValue(
    'Austin',
  )
})

const eoHeaders = () => ({ headers: { 'x-organization-slug': eoOrgSlug } })

const postDraft = (body: object) =>
  service.client.post('/v1/outreach/serve/sms/draft', body, eoHeaders())

const postCreate = (body: object) =>
  service.client.post('/v1/outreach/serve/sms', body, eoHeaders())

const getResults = (id: number) =>
  service.client.get(`/v1/outreach/serve/${id}/results`, eoHeaders())

const getReplies = (id: number, query = '') =>
  service.client.get(`/v1/outreach/serve/${id}/replies${query}`, eoHeaders())

const createInput = {
  name: 'Budget hearing reminder',
  message: 'The budget hearing is Thursday at 6pm at City Hall.',
  scheduledLocalDate: '2026-10-08',
  voterFileFilterId: 55,
}

describe('POST /v1/outreach/serve/sms/draft', () => {
  it('composes with the serve voice, the office held, and profile context', async () => {
    const res = await postDraft({ purpose: 'community_input', tone: 'warm' })

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data).toEqual({ draft: 'draft body' })
    expect(buildProfileContext).toHaveBeenCalledWith(service.user.id)
    expect(generateDraftWithVoice).toHaveBeenCalledWith(
      { purpose: 'community_input', tone: 'warm' },
      'Johnny Goodparty',
      'City Council',
      String(service.user.id),
      [
        'Where the elected official serves: Austin, TX.',
        "The official's bio, in their own words:",
      ],
      SERVE_SMS_VOICE,
    )
  })

  // Office and place are prompt enrichment: election-api is not on the
  // critical path for a draft, so its failure degrades rather than 502s.
  it('still drafts when office/place resolution fails', async () => {
    vi.spyOn(
      stub(OrganizationsService),
      'resolvePositionNameByOrganizationSlug',
    ).mockRejectedValue(new Error('election-api down'))

    const res = await postDraft({ purpose: 'introduce_myself', tone: 'direct' })

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(generateDraftWithVoice).toHaveBeenCalledWith(
      expect.anything(),
      'Johnny Goodparty',
      '',
      String(service.user.id),
      ["The official's bio, in their own words:"],
      SERVE_SMS_VOICE,
    )
  })

  // Only reachable over the wire: direct instantiation hands the controller a
  // typed object and never runs the pipe.
  it('rejects a body the draft schema does not accept', async () => {
    const res = await postDraft({ purpose: 'not_a_purpose', tone: 'warm' })

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(generateDraftWithVoice).not.toHaveBeenCalled()
  })
})

describe('POST /v1/outreach/serve/sms', () => {
  // The org is the guard's, not the body's: a client that names another
  // organization is not naming the scope this row is written under.
  it('scopes the create to the guard-resolved org and returns the counts', async () => {
    const res = await postCreate(createInput)

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(createDraft).toHaveBeenCalledWith(eoOrgSlug, createInput)
    expect(res.data).toEqual({
      outreachId: 12,
      recipientCount: 480,
      excludedOptedOutCount: 3,
      excludedDuplicateCount: 7,
    })
  })

  it('ignores an organizationSlug smuggled in the body', async () => {
    const res = await postCreate({
      ...createInput,
      organizationSlug: 'eo-somebody-else',
    })

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(createDraft).toHaveBeenCalledWith(
      eoOrgSlug,
      expect.not.objectContaining({ organizationSlug: 'eo-somebody-else' }),
    )
  })

  it('rejects a body the create schema does not accept', async () => {
    const res = await postCreate({ ...createInput, scheduledLocalDate: 12 })

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(createDraft).not.toHaveBeenCalled()
  })
})

// Access, not rollout: @UseElectedOffice() is the real check on every route
// here and answers before the flag does.
describe('Serve SMS routes without an elected office', () => {
  it('404s a draft for an org that holds no ElectedOffice row', async () => {
    const winOrgSlug = `campaign-${Date.now()}`
    await service.prisma.organization.create({
      data: { slug: winOrgSlug, ownerId: service.user.id },
    })

    const res = await service.client.post(
      '/v1/outreach/serve/sms/draft',
      { purpose: 'community_input', tone: 'warm' },
      { headers: { 'x-organization-slug': winOrgSlug } },
    )

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
    expect(generateDraftWithVoice).not.toHaveBeenCalled()
  })
})

// The whole feature ships behind serve-sms-outreach. Both WRITE routes are
// gated; everything downstream of them is inert without an Outreach row.
describe('Serve SMS feature gate', () => {
  it('404s the draft route when the flag is off, without composing', async () => {
    isFeatureEnabled.mockResolvedValue(false)

    const res = await postDraft({ purpose: 'community_input', tone: 'warm' })

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
    expect(isFeatureEnabled).toHaveBeenCalledWith({
      user: expect.objectContaining({ id: service.user.id }),
      feature: 'serve-sms-outreach',
    })
    expect(generateDraftWithVoice).not.toHaveBeenCalled()
  })

  it('404s the create route when the flag is off, without writing a row', async () => {
    isFeatureEnabled.mockResolvedValue(false)

    const res = await postCreate(createInput)

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
    expect(isFeatureEnabled).toHaveBeenCalledWith({
      user: expect.objectContaining({ id: service.user.id }),
      feature: 'serve-sms-outreach',
    })
    expect(createDraft).not.toHaveBeenCalled()
  })

  it('lets both routes through when the flag is on', async () => {
    await postDraft({ purpose: 'community_input', tone: 'warm' })
    await postCreate(createInput)

    expect(generateDraftWithVoice).toHaveBeenCalledOnce()
    expect(createDraft).toHaveBeenCalledOnce()
  })
})

describe('Serve SMS results and replies routes', () => {
  it('scopes the Statistics card to the org with campaignId pinned null', async () => {
    const res = await getResults(12)

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data).toEqual({ contacts: 480, responded: 61, optedOut: 4 })
    // campaignId: null is the ENG-10976 guard — an org holding both a
    // Campaign and an ElectedOffice must not read Win results here.
    expect(getSmsResults).toHaveBeenCalledWith(12, {
      organizationSlug: eoOrgSlug,
      campaignId: null,
    })
  })

  it('reads the org from the guard, never from a caller-supplied slug', async () => {
    const res = await getReplies(12)

    expect(res.status).toBe(HttpStatus.OK)
    expect(listReplies).toHaveBeenCalledWith(
      12,
      { organizationSlug: eoOrgSlug, campaignId: null },
      { limit: 10, offset: 0 },
    )
  })

  it('clamps the reply page: nonsense falls back, oversized caps at 200', async () => {
    await getReplies(12, '?limit=banana&offset=-5')
    expect(listReplies).toHaveBeenLastCalledWith(12, expect.anything(), {
      limit: 10,
      offset: 0,
    })

    await getReplies(12, '?limit=5000&offset=30')
    expect(listReplies).toHaveBeenLastCalledWith(12, expect.anything(), {
      limit: 200,
      offset: 30,
    })
  })

  it('serves results and replies with the rollout flag off', async () => {
    // Deliberately ungated: neither route is reachable without an Outreach
    // row, and only the flag-gated create writes one.
    isFeatureEnabled.mockResolvedValue(false)

    expect((await getResults(12)).status).toBe(HttpStatus.OK)
    expect((await getReplies(12)).status).toBe(HttpStatus.OK)
  })
})
