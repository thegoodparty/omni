import { useTestService } from '@/test-service'
import { PrismaService } from '@/prisma/prisma.service'
import {
  OutreachStatus,
  OutreachType,
  Prisma,
  RaceOpponentContrastStatus,
  RaceOpponentFindingKind,
  RaceOpponentResearchStatus,
} from '@/generated/prisma'
import { describe, expect, it, vi } from 'vitest'

// Genuine PrismaClientKnownRequestError instances, so the route hits the real
// PrismaExceptionFilter (it matches on instanceof, which a plain Error fails).
const prismaP2002 = (target: string) =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target: [target] },
  })

const prismaP2034 = () =>
  new Prisma.PrismaClientKnownRequestError('Transaction conflict', {
    code: 'P2034',
    clientVersion: 'test',
  })

const service = useTestService()

const SLUG = 'campaign-route'
const OTHER_SLUG = 'campaign-route-other'
const ORG_SLUG_HEADER = 'X-Organization-Slug'

const CONTRAST_SENTENCE =
  'On Housing, my opponent voted against the bill — I support more housing.'

const seedCampaign = async (slug: string, isPro = true) => {
  await service.prisma.organization.create({
    data: { slug, ownerId: service.user.id },
  })
  return service.prisma.campaign.create({
    data: {
      userId: service.user.id,
      slug: `${slug}-campaign`,
      organizationSlug: slug,
      isPro,
    },
  })
}

const seedCompletedSelfPass = (campaignId: number) =>
  service.prisma.raceOpponentResearch.create({
    data: {
      campaignId,
      kind: RaceOpponentFindingKind.self,
      status: RaceOpponentResearchStatus.completed,
      runId: 'self-done',
    },
  })

const seedContrast = (campaignId: number, status: RaceOpponentContrastStatus) =>
  service.prisma.raceOpponentContrast.create({
    data: {
      campaignId,
      opponentFact: 'voted against the bill',
      sourceUrl: 'https://ballotpedia.org/finding',
      candidateFact: 'support more housing',
      contrastSentence: CONTRAST_SENTENCE,
      issueTag: 'Housing',
      routing: 'story',
      status,
    },
  })

const routePath = (id: number) =>
  `/v1/campaigns/mine/race-opponent/contrasts/${id}/route`

const route = (id: number, target: 'story' | 'texting', slug = SLUG) =>
  service.client.post(
    routePath(id),
    { target },
    { headers: { [ORG_SLUG_HEADER]: slug } },
  )

describe('POST /v1/campaigns/mine/race-opponent/contrasts/:id/route', () => {
  it('routes a cleared contrast to website issues, creating the website when none exists', async () => {
    const campaign = await seedCampaign(SLUG)
    await seedCompletedSelfPass(campaign.id)
    const contrast = await seedContrast(
      campaign.id,
      RaceOpponentContrastStatus.cleared,
    )

    const result = await route(contrast.id, 'story')

    expect(result.status).toBe(201)
    expect(result.data.routedWebsiteId).toBeGreaterThan(0)
    expect(result.data.contrast.status).toBe(RaceOpponentContrastStatus.used)
    expect(result.data.contrast.routedWebsiteId).toBe(
      result.data.routedWebsiteId,
    )

    // No website existed before — one was created and the contrast became a
    // structured website issue (issueTag -> title, sentence -> description).
    const website = await service.prisma.website.findUniqueOrThrow({
      where: { campaignId: campaign.id },
    })
    expect(website.id).toBe(result.data.routedWebsiteId)
    expect(website.content?.about?.issues).toEqual([
      { title: 'Housing', description: CONTRAST_SENTENCE },
    ])

    // The contrast row is linked to the website and marked used.
    const row = await service.prisma.raceOpponentContrast.findUniqueOrThrow({
      where: { id: contrast.id },
    })
    expect(row.status).toBe(RaceOpponentContrastStatus.used)
    expect(row.routedWebsiteId).toBe(website.id)
    expect(row.routedOutreachId).toBeNull()
  })

  it('appends to existing website issues, preserving candidate-authored content', async () => {
    const campaign = await seedCampaign(SLUG)
    await seedCompletedSelfPass(campaign.id)
    await service.prisma.website.create({
      data: {
        campaignId: campaign.id,
        vanityPath: `${SLUG}-site`,
        content: {
          about: {
            bio: '<p>My bio</p>',
            issues: [{ title: 'Schools', description: 'Fund schools.' }],
          },
        },
      },
    })
    const contrast = await seedContrast(
      campaign.id,
      RaceOpponentContrastStatus.cleared,
    )

    const result = await route(contrast.id, 'story')

    expect(result.status).toBe(201)

    const website = await service.prisma.website.findUniqueOrThrow({
      where: { campaignId: campaign.id },
    })
    expect(website.id).toBe(result.data.routedWebsiteId)
    // The pre-existing issue and bio survive; the contrast is appended.
    expect(website.content?.about?.bio).toBe('<p>My bio</p>')
    expect(website.content?.about?.issues).toEqual([
      { title: 'Schools', description: 'Fund schools.' },
      { title: 'Housing', description: CONTRAST_SENTENCE },
    ])
  })

  it('retries onto the append branch when the create races into a campaign_id P2002', async () => {
    const campaign = await seedCampaign(SLUG)
    await seedCompletedSelfPass(campaign.id)
    const contrast = await seedContrast(
      campaign.id,
      RaceOpponentContrastStatus.cleared,
    )

    // Reproduce the production race: the first attempt reads no website and
    // takes the create branch, but a sibling route creates the row first, so
    // the create aborts with a campaign_id P2002. We mimic the sibling by
    // inserting the row as the first $transaction rejects, then let retryIf run
    // a real second transaction — which now finds the website and must take the
    // append branch, preserving the sibling's issue rather than 500ing.
    const prisma = service.app.get(PrismaService)
    const realTransaction = prisma.$transaction.bind(prisma)
    const spy = vi
      .spyOn(prisma, '$transaction')
      .mockImplementationOnce(async () => {
        await service.prisma.website.create({
          data: {
            campaignId: campaign.id,
            vanityPath: `${SLUG}-site`,
            content: {
              about: { issues: [{ title: 'Schools', description: 'Fund.' }] },
            },
          },
        })
        return Promise.reject(prismaP2002('campaign_id'))
      })
      // Prisma's $transaction has overloads vitest can't infer here
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockImplementation((arg: any) => realTransaction(arg))

    const result = await route(contrast.id, 'story')

    expect(result.status).toBe(201)
    // First $transaction rejected with P2002; the retry ran a second one.
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2)
    spy.mockRestore()

    const website = await service.prisma.website.findUniqueOrThrow({
      where: { campaignId: campaign.id },
    })
    expect(website.id).toBe(result.data.routedWebsiteId)
    // The retry took the append branch: the sibling's issue survives and the
    // contrast is appended after it (a fresh create would have dropped it).
    expect(website.content?.about?.issues).toEqual([
      { title: 'Schools', description: 'Fund.' },
      { title: 'Housing', description: CONTRAST_SENTENCE },
    ])

    const row = await service.prisma.raceOpponentContrast.findUniqueOrThrow({
      where: { id: contrast.id },
    })
    expect(row.status).toBe(RaceOpponentContrastStatus.used)
    expect(row.routedWebsiteId).toBe(website.id)
  })

  it('does not retry a vanity_path P2002 (slug collision surfaces, never loops)', async () => {
    const campaign = await seedCampaign(SLUG)
    await seedCompletedSelfPass(campaign.id)
    const contrast = await seedContrast(
      campaign.id,
      RaceOpponentContrastStatus.cleared,
    )

    // A P2002 on website's OTHER unique column (vanity_path) means a different
    // campaign already holds this slug — retrying can never clear it. The route
    // must surface it after a single attempt (PrismaExceptionFilter maps P2002
    // to 409), not loop the retry.
    const prisma = service.app.get(PrismaService)
    const spy = vi
      .spyOn(prisma, '$transaction')
      .mockRejectedValue(prismaP2002('vanity_path'))

    const result = await route(contrast.id, 'story')

    expect(result.status).toBe(409)
    // Exactly one attempt — the predicate refused to retry the slug conflict.
    expect(spy.mock.calls.length).toBe(1)
    spy.mockRestore()
  })

  it('retries the append when two routes race a serialization failure (P2034)', async () => {
    const campaign = await seedCampaign(SLUG)
    await seedCompletedSelfPass(campaign.id)
    // The website already exists, so both racing routes take the append branch;
    // under Serializable the loser aborts with a serialization failure (P2034).
    await service.prisma.website.create({
      data: {
        campaignId: campaign.id,
        vanityPath: `${SLUG}-site`,
        content: {
          about: { issues: [{ title: 'Schools', description: 'Fund.' }] },
        },
      },
    })
    const contrast = await seedContrast(
      campaign.id,
      RaceOpponentContrastStatus.cleared,
    )

    // First attempt aborts with P2034; retryIf must run a real second
    // transaction that appends cleanly onto the existing row.
    const prisma = service.app.get(PrismaService)
    const realTransaction = prisma.$transaction.bind(prisma)
    const spy = vi
      .spyOn(prisma, '$transaction')
      .mockRejectedValueOnce(prismaP2034())
      // Prisma's $transaction has overloads vitest can't infer here
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockImplementation((arg: any) => realTransaction(arg))

    const result = await route(contrast.id, 'story')

    expect(result.status).toBe(201)
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2)
    spy.mockRestore()

    const website = await service.prisma.website.findUniqueOrThrow({
      where: { campaignId: campaign.id },
    })
    expect(website.id).toBe(result.data.routedWebsiteId)
    // The retry appended onto the existing row: the prior issue is preserved.
    expect(website.content?.about?.issues).toEqual([
      { title: 'Schools', description: 'Fund.' },
      { title: 'Housing', description: CONTRAST_SENTENCE },
    ])

    const row = await service.prisma.raceOpponentContrast.findUniqueOrThrow({
      where: { id: contrast.id },
    })
    expect(row.status).toBe(RaceOpponentContrastStatus.used)
    expect(row.routedWebsiteId).toBe(website.id)
  })

  it('routes a cleared contrast to a pre-send draft Outreach (no send enqueued)', async () => {
    const campaign = await seedCampaign(SLUG)
    await seedCompletedSelfPass(campaign.id)
    const contrast = await seedContrast(
      campaign.id,
      RaceOpponentContrastStatus.cleared,
    )

    const result = await route(contrast.id, 'texting')

    expect(result.status).toBe(201)
    expect(result.data.routedOutreachId).toBeGreaterThan(0)
    expect(result.data.contrast.status).toBe(RaceOpponentContrastStatus.used)
    expect(result.data.contrast.routedOutreachId).toBe(
      result.data.routedOutreachId,
    )

    // A real draft Outreach was written with the contrast text...
    const outreach = await service.prisma.outreach.findUniqueOrThrow({
      where: { id: result.data.routedOutreachId },
    })
    expect(outreach.campaignId).toBe(campaign.id)
    expect(outreach.organizationSlug).toBe(SLUG)
    expect(outreach.outreachType).toBe(OutreachType.text)
    expect(outreach.message).toBe(CONTRAST_SENTENCE)
    expect(outreach.script).toBe(CONTRAST_SENTENCE)
    // ...and it stays in the pre-send (pending) state — nothing sent.
    expect(outreach.status).toBe(OutreachStatus.pending)
    expect(outreach.projectId).toBeNull()
    expect(outreach.identityId).toBeNull()

    const row = await service.prisma.raceOpponentContrast.findUniqueOrThrow({
      where: { id: contrast.id },
    })
    expect(row.status).toBe(RaceOpponentContrastStatus.used)
    expect(row.routedOutreachId).toBe(outreach.id)
    expect(row.routedWebsiteId).toBeNull()
  })

  it('409s routing a pending_review contrast (not routable)', async () => {
    const campaign = await seedCampaign(SLUG)
    await seedCompletedSelfPass(campaign.id)
    const contrast = await seedContrast(
      campaign.id,
      RaceOpponentContrastStatus.pending_review,
    )

    const result = await route(contrast.id, 'story')

    expect(result.status).toBe(409)
    // Nothing was written or stamped.
    const row = await service.prisma.raceOpponentContrast.findUniqueOrThrow({
      where: { id: contrast.id },
    })
    expect(row.status).toBe(RaceOpponentContrastStatus.pending_review)
    expect(row.routedWebsiteId).toBeNull()
    const website = await service.prisma.website.findUnique({
      where: { campaignId: campaign.id },
    })
    expect(website).toBeNull()
  })

  it('409s routing a blocked contrast (not routable)', async () => {
    const campaign = await seedCampaign(SLUG)
    await seedCompletedSelfPass(campaign.id)
    const contrast = await seedContrast(
      campaign.id,
      RaceOpponentContrastStatus.blocked,
    )

    const result = await route(contrast.id, 'texting')

    expect(result.status).toBe(409)
    const outreachCount = await service.prisma.outreach.count({
      where: { campaignId: campaign.id },
    })
    expect(outreachCount).toBe(0)
  })

  it('409s routing an already-used contrast (no double route)', async () => {
    const campaign = await seedCampaign(SLUG)
    await seedCompletedSelfPass(campaign.id)
    const contrast = await seedContrast(
      campaign.id,
      RaceOpponentContrastStatus.used,
    )

    const result = await route(contrast.id, 'story')

    expect(result.status).toBe(409)
  })

  it('404s routing a contrast owned by another campaign', async () => {
    const mine = await seedCampaign(SLUG)
    await seedCompletedSelfPass(mine.id)
    const other = await seedCampaign(OTHER_SLUG)
    const theirContrast = await seedContrast(
      other.id,
      RaceOpponentContrastStatus.cleared,
    )

    // Routed through MY org slug, targeting THEIR contrast id.
    const result = await route(theirContrast.id, 'story', SLUG)

    expect(result.status).toBe(404)
    // Their contrast is untouched.
    const row = await service.prisma.raceOpponentContrast.findUniqueOrThrow({
      where: { id: theirContrast.id },
    })
    expect(row.status).toBe(RaceOpponentContrastStatus.cleared)
    expect(row.routedWebsiteId).toBeNull()
  })

  it('403s route when no self-research pass is completed (the gate)', async () => {
    const campaign = await seedCampaign(SLUG)
    // No completed self-research pass seeded — the gate must reject.
    const contrast = await seedContrast(
      campaign.id,
      RaceOpponentContrastStatus.cleared,
    )

    const result = await route(contrast.id, 'story')

    expect(result.status).toBe(403)
    // The gate fired before any write — nothing routed.
    const row = await service.prisma.raceOpponentContrast.findUniqueOrThrow({
      where: { id: contrast.id },
    })
    expect(row.status).toBe(RaceOpponentContrastStatus.cleared)
    expect(row.routedWebsiteId).toBeNull()
  })

  it('routes an approved contrast (approved is routable)', async () => {
    const campaign = await seedCampaign(SLUG)
    await seedCompletedSelfPass(campaign.id)
    const contrast = await seedContrast(
      campaign.id,
      RaceOpponentContrastStatus.approved,
    )

    const result = await route(contrast.id, 'story')

    expect(result.status).toBe(201)
    expect(result.data.routedWebsiteId).toBeGreaterThan(0)
    expect(result.data.contrast.status).toBe(RaceOpponentContrastStatus.used)

    const row = await service.prisma.raceOpponentContrast.findUniqueOrThrow({
      where: { id: contrast.id },
    })
    expect(row.status).toBe(RaceOpponentContrastStatus.used)
    expect(row.routedWebsiteId).toBe(result.data.routedWebsiteId)
  })

  it('403s route for a non-Pro campaign', async () => {
    const campaign = await seedCampaign(SLUG, false)
    await seedCompletedSelfPass(campaign.id)
    const contrast = await seedContrast(
      campaign.id,
      RaceOpponentContrastStatus.cleared,
    )

    const result = await route(contrast.id, 'story')

    expect(result.status).toBe(403)
    const row = await service.prisma.raceOpponentContrast.findUniqueOrThrow({
      where: { id: contrast.id },
    })
    expect(row.status).toBe(RaceOpponentContrastStatus.cleared)
    expect(row.routedWebsiteId).toBeNull()
  })
})
