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
  opponentName: string = OPPONENT,
  runId: string = 'opp-done',
) =>
  service.prisma.raceOpponentResearch.create({
    data: {
      campaignId,
      kind: RaceOpponentFindingKind.opponent,
      opponentName,
      status: RaceOpponentResearchStatus.completed,
      runId,
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

  it('advances from a null lastViewedAt: first view all new, second view none', async () => {
    const campaign = await seedCampaign({ isPro: true })
    await seedSelfComplete(campaign.id)
    // Never-viewed row (lastViewedAt null) with findings persisted before the
    // first GET. First view treats all as new (no prior visit); the advance
    // writes the snapshot, so the second view flags none.
    const research = await seedOpponentResearch(campaign.id, null)
    await seedFinding(research.id, {
      claim: 'a',
      occurredAt: new Date('2020-01-01'),
      createdAt: new Date('2023-06-01T00:00:00Z'),
    })
    await seedFinding(research.id, {
      claim: 'b',
      occurredAt: new Date('2021-01-01'),
      createdAt: new Date('2023-07-01T00:00:00Z'),
    })
    flagOn()

    const first = await service.client.get(ACTIVITY_PATH, {
      headers: { [ORG_SLUG_HEADER]: SLUG },
    })
    expect(first.status).toBe(200)
    expect(
      first.data.findings.every(
        (f: { newSinceLastVisit: boolean }) => f.newSinceLastVisit === true,
      ),
    ).toBe(true)

    const second = await service.client.get(ACTIVITY_PATH, {
      headers: { [ORG_SLUG_HEADER]: SLUG },
    })
    expect(
      second.data.findings.every(
        (f: { newSinceLastVisit: boolean }) => f.newSinceLastVisit === false,
      ),
    ).toBe(true)
  })

  it('merges findings across opponent rows and uses the cross-row last-view high-water mark', async () => {
    const campaign = await seedCampaign({ isPro: true })
    await seedSelfComplete(campaign.id)
    // Two opponent rows: one never viewed (null), one viewed 2024-01-01. The
    // cross-row high-water mark is the most recent view across them (2024-01-01),
    // so a finding persisted before that is not new and one after it is new —
    // regardless of which row carries it.
    const rowA = await seedOpponentResearch(
      campaign.id,
      null,
      'Jane Rival',
      'a',
    )
    const rowB = await seedOpponentResearch(
      campaign.id,
      new Date('2024-01-01T00:00:00Z'),
      'Bob Other',
      'b',
    )
    await seedFinding(rowA.id, {
      claim: 'from-A-old',
      occurredAt: new Date('2019-01-01'),
      createdAt: new Date('2023-06-01T00:00:00Z'),
    })
    await seedFinding(rowB.id, {
      claim: 'from-B-fresh',
      occurredAt: new Date('2019-02-01'),
      createdAt: new Date('2024-06-01T00:00:00Z'),
    })
    flagOn()

    const result = await service.client.get(ACTIVITY_PATH, {
      headers: { [ORG_SLUG_HEADER]: SLUG },
    })

    expect(result.status).toBe(200)
    const byClaim = new Map(
      result.data.findings.map(
        (f: { claim: string; newSinceLastVisit: boolean }) => [
          f.claim,
          f.newSinceLastVisit,
        ],
      ),
    )
    // Both rows' findings appear (flatMap, not a single-row read).
    expect([...byClaim.keys()].sort()).toEqual(['from-A-old', 'from-B-fresh'])
    // High-water mark is 2024-01-01 (the later of null and that date), so the
    // pre-2024 finding is not new and the post-2024 one is.
    expect(byClaim.get('from-A-old')).toBe(false)
    expect(byClaim.get('from-B-fresh')).toBe(true)
  })

  it('does not flag a future occurredAt as new (falls back to createdAt)', async () => {
    const campaign = await seedCampaign({ isPro: true })
    await seedSelfComplete(campaign.id)
    const lastViewedAt = new Date('2024-01-01T00:00:00Z')
    const research = await seedOpponentResearch(campaign.id, lastViewedAt)
    // An upcoming scheduled vote: occurredAt is in the future but the finding
    // was persisted before the last view, so it must NOT read as new (its
    // future occurredAt would otherwise mark it new on every poll forever).
    await seedFinding(research.id, {
      claim: 'upcoming',
      occurredAt: new Date('2099-01-01'),
      createdAt: new Date('2023-06-01T00:00:00Z'),
    })
    flagOn()

    const result = await service.client.get(ACTIVITY_PATH, {
      headers: { [ORG_SLUG_HEADER]: SLUG },
    })

    expect(result.status).toBe(200)
    const upcoming = result.data.findings.find(
      (f: { claim: string }) => f.claim === 'upcoming',
    )
    expect(upcoming.newSinceLastVisit).toBe(false)
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

  it('reports refresh status running when no run exists yet', async () => {
    const campaign = await seedCampaign({ isPro: true })
    await seedSelfComplete(campaign.id)
    await seedOpponentResearch(campaign.id)
    flagOn()

    const result = await service.client.get(ACTIVITY_PATH, {
      headers: { [ORG_SLUG_HEADER]: SLUG },
    })

    expect(result.status).toBe(200)
    expect(result.data.refresh).toEqual({
      status: 'running',
      lastCompletedAt: null,
    })
  })

  it('reports refresh status running for an in-flight run', async () => {
    const campaign = await seedCampaign({ isPro: true })
    await seedSelfComplete(campaign.id)
    await seedOpponentResearch(campaign.id)
    await service.prisma.experimentRun.create({
      data: {
        runId: 'opp-run-running',
        organizationSlug: SLUG,
        experimentType: 'opponent_research',
        status: ExperimentRunStatus.RUNNING,
      },
    })
    flagOn()

    const result = await service.client.get(ACTIVITY_PATH, {
      headers: { [ORG_SLUG_HEADER]: SLUG },
    })

    expect(result.status).toBe(200)
    expect(result.data.refresh).toEqual({
      status: 'running',
      lastCompletedAt: null,
    })
  })

  it('reports refresh status failed for a failed latest run', async () => {
    const campaign = await seedCampaign({ isPro: true })
    await seedSelfComplete(campaign.id)
    await seedOpponentResearch(campaign.id)
    await service.prisma.experimentRun.create({
      data: {
        runId: 'opp-run-failed',
        organizationSlug: SLUG,
        experimentType: 'opponent_research',
        status: ExperimentRunStatus.FAILED,
      },
    })
    flagOn()

    const result = await service.client.get(ACTIVITY_PATH, {
      headers: { [ORG_SLUG_HEADER]: SLUG },
    })

    expect(result.status).toBe(200)
    expect(result.data.refresh).toEqual({
      status: 'failed',
      lastCompletedAt: null,
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
