import { useTestService } from '@/test-service'
import { FeaturesService } from '@/features/services/features.service'
import {
  OutreachStatus,
  OutreachType,
  RaceOpponentContrastStatus,
  RaceOpponentFindingKind,
  RaceOpponentResearchStatus,
} from '@/generated/prisma'
import { describe, expect, it, vi } from 'vitest'

const service = useTestService()

const SLUG = 'campaign-route'
const OTHER_SLUG = 'campaign-route-other'
const ORG_SLUG_HEADER = 'X-Organization-Slug'

const CONTRAST_SENTENCE =
  'On Housing, my opponent voted against the bill — I support more housing.'

const flagOn = () =>
  vi
    .spyOn(service.app.get(FeaturesService), 'isFeatureEnabled')
    .mockResolvedValue(true)

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
  it('routes a cleared contrast to Campaign Story (draft narrative + linkage + used)', async () => {
    const campaign = await seedCampaign(SLUG)
    await seedCompletedSelfPass(campaign.id)
    const contrast = await seedContrast(
      campaign.id,
      RaceOpponentContrastStatus.cleared,
    )
    flagOn()

    const result = await route(contrast.id, 'story')

    expect(result.status).toBe(201)
    expect(result.data.routedStoryId).toBeGreaterThan(0)
    expect(result.data.contrast.status).toBe(RaceOpponentContrastStatus.used)
    expect(result.data.contrast.routedStoryId).toBe(result.data.routedStoryId)

    // The narrative text was actually written into the story's issues field.
    const story = await service.prisma.campaignStory.findUniqueOrThrow({
      where: { campaignId: campaign.id },
    })
    expect(story.id).toBe(result.data.routedStoryId)
    expect(story.issues).toContain(CONTRAST_SENTENCE)

    // The contrast row is linked and marked used.
    const row = await service.prisma.raceOpponentContrast.findUniqueOrThrow({
      where: { id: contrast.id },
    })
    expect(row.status).toBe(RaceOpponentContrastStatus.used)
    expect(row.routedStoryId).toBe(story.id)
    expect(row.routedOutreachId).toBeNull()
  })

  it('routes a cleared contrast to a pre-send draft Outreach (no send enqueued)', async () => {
    const campaign = await seedCampaign(SLUG)
    await seedCompletedSelfPass(campaign.id)
    const contrast = await seedContrast(
      campaign.id,
      RaceOpponentContrastStatus.cleared,
    )
    flagOn()

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
    expect(row.routedStoryId).toBeNull()
  })

  it('409s routing a pending_review contrast (not routable)', async () => {
    const campaign = await seedCampaign(SLUG)
    await seedCompletedSelfPass(campaign.id)
    const contrast = await seedContrast(
      campaign.id,
      RaceOpponentContrastStatus.pending_review,
    )
    flagOn()

    const result = await route(contrast.id, 'story')

    expect(result.status).toBe(409)
    // Nothing was written or stamped.
    const row = await service.prisma.raceOpponentContrast.findUniqueOrThrow({
      where: { id: contrast.id },
    })
    expect(row.status).toBe(RaceOpponentContrastStatus.pending_review)
    expect(row.routedStoryId).toBeNull()
    const story = await service.prisma.campaignStory.findUnique({
      where: { campaignId: campaign.id },
    })
    expect(story).toBeNull()
  })

  it('409s routing a blocked contrast (not routable)', async () => {
    const campaign = await seedCampaign(SLUG)
    await seedCompletedSelfPass(campaign.id)
    const contrast = await seedContrast(
      campaign.id,
      RaceOpponentContrastStatus.blocked,
    )
    flagOn()

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
    flagOn()

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
    flagOn()

    // Routed through MY org slug, targeting THEIR contrast id.
    const result = await route(theirContrast.id, 'story', SLUG)

    expect(result.status).toBe(404)
    // Their contrast is untouched.
    const row = await service.prisma.raceOpponentContrast.findUniqueOrThrow({
      where: { id: theirContrast.id },
    })
    expect(row.status).toBe(RaceOpponentContrastStatus.cleared)
    expect(row.routedStoryId).toBeNull()
  })

  it('403s route when no self-research pass is completed (the gate)', async () => {
    const campaign = await seedCampaign(SLUG)
    // No completed self-research pass seeded — the gate must reject.
    const contrast = await seedContrast(
      campaign.id,
      RaceOpponentContrastStatus.cleared,
    )
    flagOn()

    const result = await route(contrast.id, 'story')

    expect(result.status).toBe(403)
    // The gate fired before any write — nothing routed.
    const row = await service.prisma.raceOpponentContrast.findUniqueOrThrow({
      where: { id: contrast.id },
    })
    expect(row.status).toBe(RaceOpponentContrastStatus.cleared)
    expect(row.routedStoryId).toBeNull()
  })

  it('routes an approved contrast (approved is routable)', async () => {
    const campaign = await seedCampaign(SLUG)
    await seedCompletedSelfPass(campaign.id)
    const contrast = await seedContrast(
      campaign.id,
      RaceOpponentContrastStatus.approved,
    )
    flagOn()

    const result = await route(contrast.id, 'story')

    expect(result.status).toBe(201)
    expect(result.data.routedStoryId).toBeGreaterThan(0)
    expect(result.data.contrast.status).toBe(RaceOpponentContrastStatus.used)

    const row = await service.prisma.raceOpponentContrast.findUniqueOrThrow({
      where: { id: contrast.id },
    })
    expect(row.status).toBe(RaceOpponentContrastStatus.used)
    expect(row.routedStoryId).toBe(result.data.routedStoryId)
  })

  it('403s route for a non-Pro campaign', async () => {
    const campaign = await seedCampaign(SLUG, false)
    await seedCompletedSelfPass(campaign.id)
    const contrast = await seedContrast(
      campaign.id,
      RaceOpponentContrastStatus.cleared,
    )
    flagOn()

    const result = await route(contrast.id, 'story')

    expect(result.status).toBe(403)
    const row = await service.prisma.raceOpponentContrast.findUniqueOrThrow({
      where: { id: contrast.id },
    })
    expect(row.status).toBe(RaceOpponentContrastStatus.cleared)
    expect(row.routedStoryId).toBeNull()
  })

  it('403s route when the feature flag is off', async () => {
    const campaign = await seedCampaign(SLUG)
    await seedCompletedSelfPass(campaign.id)
    const contrast = await seedContrast(
      campaign.id,
      RaceOpponentContrastStatus.cleared,
    )
    vi.spyOn(
      service.app.get(FeaturesService),
      'isFeatureEnabled',
    ).mockResolvedValue(false)

    const result = await route(contrast.id, 'story')

    expect(result.status).toBe(403)
    const row = await service.prisma.raceOpponentContrast.findUniqueOrThrow({
      where: { id: contrast.id },
    })
    expect(row.status).toBe(RaceOpponentContrastStatus.cleared)
    expect(row.routedStoryId).toBeNull()
  })
})
