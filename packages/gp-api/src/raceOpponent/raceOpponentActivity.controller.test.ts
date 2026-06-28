import { describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { FeaturesService } from '@/features/services/features.service'
import {
  ExperimentRunStatus,
  RaceOpponentFindingKind,
  RaceOpponentResearchStatus,
} from '@/generated/prisma'

const service = useTestService()

const SLUG = 'campaign-activity'
const ORG_SLUG_HEADER = 'X-Organization-Slug'
const ACTIVITY_PATH = '/v1/campaigns/mine/race-opponent/opponents/activity'
const OPPONENT = 'Jane Rival'

const seedCampaign = async (opts: { isPro: boolean }) => {
  await service.prisma.organization.create({
    data: { slug: SLUG, ownerId: service.user.id },
  })
  return service.prisma.campaign.create({
    data: {
      userId: service.user.id,
      slug: `${SLUG}-campaign`,
      organizationSlug: SLUG,
      isPro: opts.isPro,
    },
  })
}

const seedSelfComplete = (campaignId: number) =>
  service.prisma.raceOpponentResearch.create({
    data: {
      campaignId,
      kind: RaceOpponentFindingKind.self,
      status: RaceOpponentResearchStatus.completed,
      runId: 'self-done',
    },
  })

const seedOpponentResearch = (
  campaignId: number,
  lastViewedAt: Date | null = null,
) =>
  service.prisma.raceOpponentResearch.create({
    data: {
      campaignId,
      kind: RaceOpponentFindingKind.opponent,
      opponentName: OPPONENT,
      status: RaceOpponentResearchStatus.completed,
      runId: 'opp-done',
      lastViewedAt,
    },
  })

const seedFinding = (
  researchId: number,
  opts: { claim: string; occurredAt: Date | null; createdAt?: Date },
) =>
  service.prisma.raceOpponentFinding.create({
    data: {
      researchId,
      claim: opts.claim,
      sourceUrl: 'https://ballotpedia.org/Jane_Rival',
      sourceExtract: 'extract',
      category: 'record',
      occurredAt: opts.occurredAt,
      sourceReachableAt: new Date(),
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    },
  })

const flagOn = () =>
  vi
    .spyOn(service.app.get(FeaturesService), 'isFeatureEnabled')
    .mockResolvedValue(true)

describe('GET /opponents/activity', () => {
  it('returns findings in occurredAt order, undated last', async () => {
    const campaign = await seedCampaign({ isPro: true })
    await seedSelfComplete(campaign.id)
    const research = await seedOpponentResearch(campaign.id)
    await seedFinding(research.id, {
      claim: 'middle',
      occurredAt: new Date('2021-06-01'),
    })
    await seedFinding(research.id, {
      claim: 'earliest',
      occurredAt: new Date('2020-01-01'),
    })
    await seedFinding(research.id, { claim: 'undated', occurredAt: null })
    flagOn()

    const result = await service.client.get(ACTIVITY_PATH, {
      headers: { [ORG_SLUG_HEADER]: SLUG },
    })

    expect(result.status).toBe(200)
    expect(result.data.findings.map((f: { claim: string }) => f.claim)).toEqual(
      ['earliest', 'middle', 'undated'],
    )
  })

  it('flags items after lastViewedAt as new, and viewing advances it', async () => {
    const campaign = await seedCampaign({ isPro: true })
    await seedSelfComplete(campaign.id)
    const lastViewedAt = new Date('2024-01-01T00:00:00Z')
    const research = await seedOpponentResearch(campaign.id, lastViewedAt)
    // Persisted (createdAt) before the last view => not new.
    await seedFinding(research.id, {
      claim: 'old',
      occurredAt: new Date('2019-01-01'),
      createdAt: new Date('2023-06-01T00:00:00Z'),
    })
    // Persisted after the last view => new.
    await seedFinding(research.id, {
      claim: 'fresh',
      occurredAt: new Date('2019-02-01'),
      createdAt: new Date('2024-06-01T00:00:00Z'),
    })
    flagOn()

    const first = await service.client.get(ACTIVITY_PATH, {
      headers: { [ORG_SLUG_HEADER]: SLUG },
    })

    expect(first.status).toBe(200)
    const byClaim = new Map(
      first.data.findings.map(
        (f: { claim: string; newSinceLastVisit: boolean }) => [
          f.claim,
          f.newSinceLastVisit,
        ],
      ),
    )
    expect(byClaim.get('old')).toBe(false)
    expect(byClaim.get('fresh')).toBe(true)

    // Viewing advanced lastViewedAt to now; nothing reads as new on re-view.
    const second = await service.client.get(ACTIVITY_PATH, {
      headers: { [ORG_SLUG_HEADER]: SLUG },
    })
    expect(
      second.data.findings.every(
        (f: { newSinceLastVisit: boolean }) => f.newSinceLastVisit === false,
      ),
    ).toBe(true)
  })

  it('mirrors the community-issues refresh envelope shape', async () => {
    const campaign = await seedCampaign({ isPro: true })
    await seedSelfComplete(campaign.id)
    await seedOpponentResearch(campaign.id)
    await service.prisma.experimentRun.create({
      data: {
        runId: 'opp-run-complete',
        organizationSlug: SLUG,
        experimentType: 'opponent_research',
        status: ExperimentRunStatus.COMPLETED,
        artifactBucket: 'bucket',
        artifactKey: 'opp-run-complete.json',
      },
    })
    flagOn()

    const result = await service.client.get(ACTIVITY_PATH, {
      headers: { [ORG_SLUG_HEADER]: SLUG },
    })

    expect(result.status).toBe(200)
    expect(result.data.refresh).toEqual({
      status: 'completed',
      lastCompletedAt: expect.any(String),
    })
  })

  it('403s without a completed self-research pass', async () => {
    const campaign = await seedCampaign({ isPro: true })
    await seedOpponentResearch(campaign.id)
    flagOn()

    const result = await service.client.get(ACTIVITY_PATH, {
      headers: { [ORG_SLUG_HEADER]: SLUG },
    })

    expect(result.status).toBe(403)
  })

  it('403s for a non-Pro campaign', async () => {
    const campaign = await seedCampaign({ isPro: false })
    await seedSelfComplete(campaign.id)
    flagOn()

    const result = await service.client.get(ACTIVITY_PATH, {
      headers: { [ORG_SLUG_HEADER]: SLUG },
    })

    expect(result.status).toBe(403)
  })

  it('403s when the flag is off', async () => {
    const campaign = await seedCampaign({ isPro: true })
    await seedSelfComplete(campaign.id)
    vi.spyOn(
      service.app.get(FeaturesService),
      'isFeatureEnabled',
    ).mockResolvedValue(false)

    const result = await service.client.get(ACTIVITY_PATH, {
      headers: { [ORG_SLUG_HEADER]: SLUG },
    })

    expect(result.status).toBe(403)
  })
})
