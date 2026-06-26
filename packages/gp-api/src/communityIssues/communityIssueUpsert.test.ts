import {
  CommunityIssueCategory,
  CommunityIssueList,
  CommunityIssuePriority,
  ExperimentRunStatus,
} from '../generated/prisma'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { EVENTS } from '@/vendors/segment/segment.types'
import { useTestService } from '@/test-service'
// Imported after useTestService: analytics.service sits on a circular import
// chain (analytics -> users -> campaigns -> analytics) and must not be the
// first app-graph module evaluated, or Nest sees an undefined DI token.
import { AnalyticsService } from '@/analytics/analytics.service'
import { CommunityIssueService } from './services/communityIssue.service'

const service = useTestService()

// ── helpers ──────────────────────────────────────────────────────────────────

const ORG = 'test-org-ci'
const BUCKET = 'artifact-bucket'

const seedOrg = async (slug = ORG) => {
  await service.prisma.organization.upsert({
    where: { slug },
    create: { slug, ownerId: service.user.id },
    update: {},
  })
}

const seedRun = async (
  orgSlug: string,
  experimentType: 'top_community_issues' | 'trending_issues',
  artifactKey: string,
) =>
  service.prisma.experimentRun.create({
    data: {
      organizationSlug: orgSlug,
      experimentType,
      status: ExperimentRunStatus.COMPLETED,
      artifactBucket: BUCKET,
      artifactKey,
    },
  })

const mockS3 = (responses: Record<string, string | undefined>) => {
  vi.spyOn(service.app.get(S3Service), 'getFile').mockImplementation(
    async (_bucket, key) => responses[key],
  )
}

const makeSource = (id: string) => ({
  id,
  name: 'Test Source',
  retrieved_at: '2026-01-01T00:00:00Z',
  retrieved_text_or_snapshot: 'content',
  source_type: 'news',
})

const makeIssue = (rank: number, overrides: Record<string, unknown> = {}) => ({
  category: 'public_safety',
  rank,
  priority: 'high',
  title: `Issue ${rank}`,
  summary: `Summary for issue ${rank}.`,
  detail: {
    sources: [makeSource('src-1')],
    overview: { source_ids: ['src-1'], summary: 'Overview.' },
  },
  ...overrides,
})

const makeArtifact = (
  orgSlug: string,
  runId: string,
  issues: unknown[] = [makeIssue(1)],
  list: 'top_community' | 'trending' = 'top_community',
) => ({
  schema_version: 1,
  list,
  organization_slug: orgSlug,
  generated_for_run_id: runId,
  data_quality: 'ok',
  issues,
})

// ── setup ─────────────────────────────────────────────────────────────────────

beforeEach(async () => {
  await seedOrg()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ── tests ─────────────────────────────────────────────────────────────────────

describe('CommunityIssueService.onExperimentRunCompleted', () => {
  it('is a no-op for unrelated experiment types', async () => {
    mockS3({})
    const run = await service.prisma.experimentRun.create({
      data: {
        organizationSlug: ORG,
        experimentType: 'meeting_briefing',
        status: ExperimentRunStatus.COMPLETED,
        artifactBucket: BUCKET,
        artifactKey: 'irrelevant.json',
      },
    })
    await service.app.get(CommunityIssueService).onExperimentRunCompleted(run)

    const count = await service.prisma.communityIssue.count()
    expect(count).toBe(0)
  })

  it('creates new issues from a valid artifact', async () => {
    const key = `create-${Date.now()}.json`
    const run = await seedRun(ORG, 'top_community_issues', key)
    mockS3({
      [key]: JSON.stringify(
        makeArtifact(ORG, run.runId, [makeIssue(1), makeIssue(2)]),
      ),
    })

    await service.app.get(CommunityIssueService).onExperimentRunCompleted(run)

    const rows = await service.prisma.communityIssue.findMany({
      where: { organizationSlug: ORG },
      orderBy: { rank: 'asc' },
    })
    expect(rows).toHaveLength(2)
    expect(rows[0].rank).toBe(1)
    expect(rows[1].rank).toBe(2)
    expect(rows[0].lastRefreshedRunId).toBe(run.runId)
    expect(rows[0].archivedAt).toBeNull()
    expect(rows[0].list).toBe(CommunityIssueList.top_community)
    expect(rows[0].category).toBe(CommunityIssueCategory.public_safety)
    expect(rows[0].priority).toBe(CommunityIssuePriority.high)
  })

  it('persists only the valid issues when some fail validation', async () => {
    const key = `mixed-${Date.now()}.json`
    const run = await seedRun(ORG, 'top_community_issues', key)
    mockS3({
      [key]: JSON.stringify(
        makeArtifact(ORG, run.runId, [
          makeIssue(1), // valid → persisted
          makeIssue(2, { category: 'bogus_category' }), // invalid → dropped
        ]),
      ),
    })

    await service.app.get(CommunityIssueService).onExperimentRunCompleted(run)

    const rows = await service.prisma.communityIssue.findMany({
      where: { organizationSlug: ORG },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].rank).toBe(1)
  })

  it('updates an issue with a matching existing_issue_id', async () => {
    const existing = await service.prisma.communityIssue.create({
      data: {
        organizationSlug: ORG,
        list: CommunityIssueList.top_community,
        category: CommunityIssueCategory.public_safety,
        priority: CommunityIssuePriority.low,
        title: 'Old Title',
        summary: 'Old summary.',
        rank: 5,
      },
    })

    const key = `update-${Date.now()}.json`
    const run = await seedRun(ORG, 'top_community_issues', key)
    const updatedIssue = makeIssue(1, {
      existing_issue_id: existing.id,
      title: 'Updated Title',
      priority: 'high',
      category: 'education',
    })
    mockS3({
      [key]: JSON.stringify(makeArtifact(ORG, run.runId, [updatedIssue])),
    })

    await service.app.get(CommunityIssueService).onExperimentRunCompleted(run)

    const row = await service.prisma.communityIssue.findUnique({
      where: { id: existing.id },
    })
    expect(row?.title).toBe('Updated Title')
    expect(row?.rank).toBe(1)
    expect(row?.lastRefreshedRunId).toBe(run.runId)
    expect(row?.priority).toBe(CommunityIssuePriority.high)
    expect(row?.category).toBe(CommunityIssueCategory.education)
  })

  it('archives active rows absent from the new result', async () => {
    const toKeep = await service.prisma.communityIssue.create({
      data: {
        organizationSlug: ORG,
        list: CommunityIssueList.top_community,
        category: CommunityIssueCategory.public_safety,
        priority: CommunityIssuePriority.high,
        title: 'Kept',
        summary: 'stays.',
      },
    })
    const toArchive = await service.prisma.communityIssue.create({
      data: {
        organizationSlug: ORG,
        list: CommunityIssueList.top_community,
        category: CommunityIssueCategory.education,
        priority: CommunityIssuePriority.low,
        title: 'Gone',
        summary: 'gets archived.',
      },
    })

    const key = `archive-${Date.now()}.json`
    const run = await seedRun(ORG, 'top_community_issues', key)
    mockS3({
      [key]: JSON.stringify(
        makeArtifact(ORG, run.runId, [
          makeIssue(1, { existing_issue_id: toKeep.id }),
        ]),
      ),
    })

    await service.app.get(CommunityIssueService).onExperimentRunCompleted(run)

    const kept = await service.prisma.communityIssue.findUnique({
      where: { id: toKeep.id },
    })
    expect(kept?.archivedAt).toBeNull()

    const archived = await service.prisma.communityIssue.findUnique({
      where: { id: toArchive.id },
    })
    expect(archived?.archivedAt).not.toBeNull()
  })

  it('resurrects an archived row by clearing archivedAt', async () => {
    const archived = await service.prisma.communityIssue.create({
      data: {
        organizationSlug: ORG,
        list: CommunityIssueList.top_community,
        category: CommunityIssueCategory.public_safety,
        priority: CommunityIssuePriority.low,
        title: 'Archived Issue',
        summary: 'was archived.',
        archivedAt: new Date('2025-01-01'),
      },
    })

    const key = `resurrect-${Date.now()}.json`
    const run = await seedRun(ORG, 'top_community_issues', key)
    mockS3({
      [key]: JSON.stringify(
        makeArtifact(ORG, run.runId, [
          makeIssue(1, {
            existing_issue_id: archived.id,
            title: 'Resurrected Issue',
          }),
        ]),
      ),
    })

    await service.app.get(CommunityIssueService).onExperimentRunCompleted(run)

    const row = await service.prisma.communityIssue.findUnique({
      where: { id: archived.id },
    })
    expect(row?.archivedAt).toBeNull()
    expect(row?.title).toBe('Resurrected Issue')
  })

  it('rejects the whole run when existing_issue_id belongs to a different org', async () => {
    const otherOrg = `other-org-${Date.now()}`
    await seedOrg(otherOrg)
    const foreignIssue = await service.prisma.communityIssue.create({
      data: {
        organizationSlug: otherOrg,
        list: CommunityIssueList.top_community,
        category: CommunityIssueCategory.public_safety,
        priority: CommunityIssuePriority.high,
        title: 'Foreign',
        summary: 'belongs to other org.',
      },
    })

    const priorIssue = await service.prisma.communityIssue.create({
      data: {
        organizationSlug: ORG,
        list: CommunityIssueList.top_community,
        category: CommunityIssueCategory.education,
        priority: CommunityIssuePriority.low,
        title: 'Prior',
        summary: 'should be unchanged.',
        rank: 1,
      },
    })

    const key = `foreign-${Date.now()}.json`
    const run = await seedRun(ORG, 'top_community_issues', key)
    mockS3({
      [key]: JSON.stringify(
        makeArtifact(ORG, run.runId, [
          makeIssue(1, { existing_issue_id: foreignIssue.id }),
        ]),
      ),
    })

    await service.app.get(CommunityIssueService).onExperimentRunCompleted(run)

    const unchanged = await service.prisma.communityIssue.findUnique({
      where: { id: priorIssue.id },
    })
    expect(unchanged?.lastRefreshedRunId).toBeNull()
    expect(unchanged?.archivedAt).toBeNull()
    expect(unchanged?.rank).toBe(1)
  })

  it('rejects the whole run when existing_issue_id belongs to the wrong list', async () => {
    const topIssue = await service.prisma.communityIssue.create({
      data: {
        organizationSlug: ORG,
        list: CommunityIssueList.top_community,
        category: CommunityIssueCategory.public_safety,
        priority: CommunityIssuePriority.high,
        title: 'Top Issue',
        summary: 'in top_community list.',
        rank: 1,
      },
    })

    const key = `cross-list-${Date.now()}.json`
    const run = await seedRun(ORG, 'trending_issues', key)
    mockS3({
      [key]: JSON.stringify(
        makeArtifact(
          ORG,
          run.runId,
          [makeIssue(1, { existing_issue_id: topIssue.id })],
          'trending',
        ),
      ),
    })

    await service.app.get(CommunityIssueService).onExperimentRunCompleted(run)

    const unchanged = await service.prisma.communityIssue.findUnique({
      where: { id: topIssue.id },
    })
    expect(unchanged?.lastRefreshedRunId).toBeNull()
    expect(unchanged?.archivedAt).toBeNull()
  })

  it('skips upsert when artifact org does not match run org', async () => {
    const prior = await service.prisma.communityIssue.create({
      data: {
        organizationSlug: ORG,
        list: CommunityIssueList.top_community,
        category: CommunityIssueCategory.public_safety,
        priority: CommunityIssuePriority.high,
        title: 'Prior',
        summary: 'prior.',
      },
    })

    const key = `wrong-org-${Date.now()}.json`
    const run = await seedRun(ORG, 'top_community_issues', key)
    mockS3({
      [key]: JSON.stringify(
        makeArtifact('different-org', run.runId, [makeIssue(1)]),
      ),
    })

    await service.app.get(CommunityIssueService).onExperimentRunCompleted(run)

    const unchanged = await service.prisma.communityIssue.findUnique({
      where: { id: prior.id },
    })
    expect(unchanged?.lastRefreshedRunId).toBeNull()
    expect(unchanged?.archivedAt).toBeNull()
  })

  it('skips upsert when artifact generated_for_run_id does not match run id', async () => {
    const prior = await service.prisma.communityIssue.create({
      data: {
        organizationSlug: ORG,
        list: CommunityIssueList.top_community,
        category: CommunityIssueCategory.public_safety,
        priority: CommunityIssuePriority.high,
        title: 'Prior',
        summary: 'prior.',
      },
    })

    const key = `wrong-run-id-${Date.now()}.json`
    const run = await seedRun(ORG, 'top_community_issues', key)
    mockS3({
      [key]: JSON.stringify(
        makeArtifact(ORG, 'completely-different-run-id', [makeIssue(1)]),
      ),
    })

    await service.app.get(CommunityIssueService).onExperimentRunCompleted(run)

    const unchanged = await service.prisma.communityIssue.findUnique({
      where: { id: prior.id },
    })
    expect(unchanged?.lastRefreshedRunId).toBeNull()
    expect(unchanged?.archivedAt).toBeNull()
  })

  it('rejects an artifact with more than 10 issues — nothing changes', async () => {
    const prior = await service.prisma.communityIssue.create({
      data: {
        organizationSlug: ORG,
        list: CommunityIssueList.top_community,
        category: CommunityIssueCategory.public_safety,
        priority: CommunityIssuePriority.high,
        title: 'Prior',
        summary: 'prior.',
      },
    })

    const issues = Array.from({ length: 11 }, (_, i) =>
      makeIssue(i + 1, { title: `Issue ${i + 1}` }),
    )
    const key = `over-cap-${Date.now()}.json`
    const run = await seedRun(ORG, 'top_community_issues', key)
    mockS3({
      [key]: JSON.stringify(makeArtifact(ORG, run.runId, issues)),
    })

    await service.app.get(CommunityIssueService).onExperimentRunCompleted(run)

    const allRows = await service.prisma.communityIssue.findMany({
      where: { organizationSlug: ORG },
    })
    expect(allRows).toHaveLength(1)
    expect(allRows[0].id).toBe(prior.id)
    expect(allRows[0].lastRefreshedRunId).toBeNull()
  })

  it('rejects an artifact with an unknown category — nothing changes', async () => {
    const prior = await service.prisma.communityIssue.create({
      data: {
        organizationSlug: ORG,
        list: CommunityIssueList.top_community,
        category: CommunityIssueCategory.public_safety,
        priority: CommunityIssuePriority.high,
        title: 'Prior',
        summary: 'prior.',
      },
    })

    const key = `bad-category-${Date.now()}.json`
    const run = await seedRun(ORG, 'top_community_issues', key)
    mockS3({
      [key]: JSON.stringify(
        makeArtifact(ORG, run.runId, [
          makeIssue(1, { category: 'bogus_category' }),
        ]),
      ),
    })

    await service.app.get(CommunityIssueService).onExperimentRunCompleted(run)

    const row = await service.prisma.communityIssue.findUnique({
      where: { id: prior.id },
    })
    expect(row?.lastRefreshedRunId).toBeNull()
  })

  it('stamps rank and lastRefreshedRunId on all upserted rows', async () => {
    const key = `stamp-${Date.now()}.json`
    const run = await seedRun(ORG, 'trending_issues', key)
    mockS3({
      [key]: JSON.stringify(
        makeArtifact(ORG, run.runId, [makeIssue(3), makeIssue(7)], 'trending'),
      ),
    })

    await service.app.get(CommunityIssueService).onExperimentRunCompleted(run)

    const rows = await service.prisma.communityIssue.findMany({
      where: { organizationSlug: ORG },
      orderBy: { rank: 'asc' },
    })
    expect(rows[0].rank).toBe(3)
    expect(rows[1].rank).toBe(7)
    expect(rows.every((r) => r.lastRefreshedRunId === run.runId)).toBe(true)
    expect(rows[0].list).toBe(CommunityIssueList.trending)
  })
})

describe('CommunityIssueService analytics events', () => {
  const s3Responses: Record<string, string> = {}
  let keyCounter = 0
  let trackSpy: MockInstance

  const callsFor = (eventName: string) =>
    trackSpy.mock.calls.filter((c) => c[1] === eventName)

  const generate = async (
    type: 'top_community_issues' | 'trending_issues',
    list: 'top_community' | 'trending',
    issues: unknown[],
  ) => {
    const key = `evt-${keyCounter++}.json`
    const run = await seedRun(ORG, type, key)
    s3Responses[key] = JSON.stringify(
      makeArtifact(ORG, run.runId, issues, list),
    )
    await service.app.get(CommunityIssueService).onExperimentRunCompleted(run)
    return run
  }

  beforeEach(async () => {
    for (const k of Object.keys(s3Responses)) delete s3Responses[k]
    keyCounter = 0
    await service.prisma.electedOffice.create({
      data: { organizationSlug: ORG, userId: service.user.id },
    })
    vi.spyOn(service.app.get(S3Service), 'getFile').mockImplementation(
      async (_bucket, key) => s3Responses[key],
    )
    trackSpy = vi
      .spyOn(service.app.get(AnalyticsService), 'track')
      .mockResolvedValue(undefined as never)
  })

  it('fires Initial Issues Generated once, when the second list generates', async () => {
    await generate('top_community_issues', 'top_community', [makeIssue(1)])
    expect(
      callsFor(EVENTS.CommunityIssues.InitialIssuesGenerated),
    ).toHaveLength(0)
    expect(
      callsFor(EVENTS.CommunityIssues.HighPriorityTrendingIssueCreated),
    ).toHaveLength(0)

    await generate('trending_issues', 'trending', [makeIssue(1)])
    const initial = callsFor(EVENTS.CommunityIssues.InitialIssuesGenerated)
    expect(initial).toHaveLength(1)
    expect(initial[0][0]).toBe(service.user.id)
    expect(initial[0][2]).toMatchObject({
      topIssueCount: 1,
      trendingIssueCount: 1,
      topIssue1Title: 'Issue 1',
      topIssue1Summary: 'Summary for issue 1.',
      topIssue1Priority: 'high',
      trendingIssue1Title: 'Issue 1',
      trendingIssue1Priority: 'high',
    })
  })

  it('does not refire Initial Issues Generated on later refreshes', async () => {
    await generate('top_community_issues', 'top_community', [makeIssue(1)])
    await generate('trending_issues', 'trending', [makeIssue(1)])
    trackSpy.mockClear()

    await generate('top_community_issues', 'top_community', [makeIssue(2)])
    expect(
      callsFor(EVENTS.CommunityIssues.InitialIssuesGenerated),
    ).toHaveLength(0)
  })

  it('does not fire Initial Issues Generated when the other list has no live issues', async () => {
    // Trending generates, then empties (the AI returns no issues, archiving
    // all rows). Top then has its first generation: the org has "ever
    // generated" both lists, but trending currently shows zero live issues —
    // so no event, to avoid an email with an empty section.
    await generate('trending_issues', 'trending', [makeIssue(1)])
    await generate('trending_issues', 'trending', [])
    await generate('top_community_issues', 'top_community', [makeIssue(1)])
    expect(
      callsFor(EVENTS.CommunityIssues.InitialIssuesGenerated),
    ).toHaveLength(0)
  })

  it('fires High Priority Trending only for new high issues on a refresh', async () => {
    await generate('trending_issues', 'trending', [
      makeIssue(1, { priority: 'high' }),
    ])
    expect(
      callsFor(EVENTS.CommunityIssues.HighPriorityTrendingIssueCreated),
    ).toHaveLength(0)

    trackSpy.mockClear()
    await generate('trending_issues', 'trending', [
      makeIssue(2, { priority: 'high', title: 'New High Issue' }),
    ])
    const high = callsFor(
      EVENTS.CommunityIssues.HighPriorityTrendingIssueCreated,
    )
    expect(high).toHaveLength(1)
    expect(high[0][2]).toMatchObject({ title: 'New High Issue' })
  })

  it('fires Top Issue Priority Changed when a main-list issue changes priority', async () => {
    const existing = await service.prisma.communityIssue.create({
      data: {
        organizationSlug: ORG,
        list: CommunityIssueList.top_community,
        category: CommunityIssueCategory.public_safety,
        priority: CommunityIssuePriority.low,
        title: 'Pothole backlog',
        summary: 'Crews are behind on road repairs.',
        rank: 1,
      },
    })

    await generate('top_community_issues', 'top_community', [
      makeIssue(1, {
        existing_issue_id: existing.id,
        priority: 'high',
        title: 'Pothole backlog',
        summary: 'Crews are behind on road repairs.',
      }),
    ])

    const changes = callsFor(EVENTS.CommunityIssues.TopIssuePriorityChanged)
    expect(changes).toHaveLength(1)
    expect(changes[0][2]).toMatchObject({
      issueId: existing.id,
      previousPriority: 'low',
      priority: 'high',
    })
  })

  it('does not fire Top Issue Priority Changed for the trending list', async () => {
    const existing = await service.prisma.communityIssue.create({
      data: {
        organizationSlug: ORG,
        list: CommunityIssueList.trending,
        category: CommunityIssueCategory.public_safety,
        priority: CommunityIssuePriority.low,
        title: 'Parking fee proposal',
        summary: 'Pushback on a meter rate hike.',
        rank: 1,
      },
    })

    await generate('trending_issues', 'trending', [
      makeIssue(1, { existing_issue_id: existing.id, priority: 'high' }),
    ])

    expect(
      callsFor(EVENTS.CommunityIssues.TopIssuePriorityChanged),
    ).toHaveLength(0)
  })
})
