import { useTestService } from '@/test-service'
import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { v7 as uuidv7 } from 'uuid'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { ExperimentRunsService } from '@/agentExperiments/services/experimentRuns.service'
import {
  CommunityIssueCategory,
  CommunityIssueList,
  CommunityIssuePriority,
  ExperimentRunStatus,
} from '../generated/prisma'

const service = useTestService()

const BASE = '/v1/community-issues'

let eoId: string
let eoOrgSlug: string

const eoHeaders = () => ({
  headers: { 'x-organization-slug': eoOrgSlug },
})

const seedElectedOffice = async () => {
  eoId = uuidv7()
  eoOrgSlug = `eo-ci-${eoId}`
  await service.prisma.organization.create({
    data: { slug: eoOrgSlug, ownerId: service.user.id },
  })
  await service.prisma.electedOffice.create({
    data: { id: eoId, userId: service.user.id, organizationSlug: eoOrgSlug },
  })
}

const seedIssue = (
  overrides: Partial<{
    list: CommunityIssueList
    rank: number | null
    archivedAt: Date | null
    organizationSlug: string
  }> = {},
) =>
  service.prisma.communityIssue.create({
    data: {
      organizationSlug: overrides.organizationSlug ?? eoOrgSlug,
      list: overrides.list ?? CommunityIssueList.top_community,
      category: CommunityIssueCategory.public_safety,
      priority: CommunityIssuePriority.high,
      title: 'Road Maintenance',
      summary: 'Roads need fixing.',
      detail: { overview: { summary: 'ok' }, sources: [] },
      rank: overrides.rank ?? 1,
      archivedAt: overrides.archivedAt ?? null,
    },
  })

const seedExperimentRun = (
  experimentType: 'top_community_issues' | 'trending_issues',
  status: ExperimentRunStatus,
) =>
  service.prisma.experimentRun.create({
    data: {
      organizationSlug: eoOrgSlug,
      experimentType,
      status,
      artifactBucket: 'bucket',
      artifactKey: `key-${Date.now()}.json`,
    },
  })

beforeEach(async () => {
  await seedElectedOffice()
})

describe('GET /v1/community-issues', () => {
  it(
    'returns only active issues for the caller org + list, ordered by rank ASC' +
      ' with correct prioritized flag',
    async () => {
      const issue1 = await seedIssue({ rank: 2 })
      const issue2 = await seedIssue({ rank: 1 })
      const archived = await seedIssue({
        rank: 3,
        archivedAt: new Date('2025-01-01'),
      })

      await service.prisma.priority.create({
        data: {
          electedOfficeId: eoId,
          title: 'prio',
          description: 'desc',
          source: 'community_issue',
          sourceCommunityIssueId: issue1.id,
        },
      })

      await seedExperimentRun(
        'top_community_issues',
        ExperimentRunStatus.COMPLETED,
      )

      const res = await service.client.get<{
        issues: {
          id: string
          rank: number
          prioritized: boolean
        }[]
        refresh: {
          status: string
          lastCompletedAt: string | null
        }
      }>(`${BASE}?list=top_community`, eoHeaders())

      expect(res.status).toBe(HttpStatus.OK)
      const ids = res.data.issues.map((i) => i.id)
      expect(ids).not.toContain(archived.id)
      expect(ids[0]).toBe(issue2.id)
      expect(ids[1]).toBe(issue1.id)

      const p1 = res.data.issues.find((i) => i.id === issue1.id)
      const p2 = res.data.issues.find((i) => i.id === issue2.id)
      expect(p1?.prioritized).toBe(true)
      expect(p2?.prioritized).toBe(false)

      expect(res.data.refresh.status).toBe('completed')
      expect(typeof res.data.refresh.lastCompletedAt).toBe('string')
    },
  )

  it('returns refresh.status=running when no ExperimentRun exists yet', async () => {
    await seedIssue()

    const res = await service.client.get<{
      refresh: { status: string; lastCompletedAt: string | null }
    }>(`${BASE}?list=top_community`, eoHeaders())

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.refresh.status).toBe('running')
    expect(res.data.refresh.lastCompletedAt).toBeNull()
  })

  it(
    'refresh.status reflects the latest ExperimentRun status;' +
      ' lastCompletedAt is ISO string from COMPLETED run updatedAt',
    async () => {
      await seedIssue()

      const completed = await seedExperimentRun(
        'top_community_issues',
        ExperimentRunStatus.COMPLETED,
      )
      await seedExperimentRun(
        'top_community_issues',
        ExperimentRunStatus.RUNNING,
      )

      const res = await service.client.get<{
        refresh: { status: string; lastCompletedAt: string | null }
      }>(`${BASE}?list=top_community`, eoHeaders())

      expect(res.status).toBe(HttpStatus.OK)
      expect(res.data.refresh.status).toBe('running')
      expect(res.data.refresh.lastCompletedAt).toBe(
        completed.updatedAt.toISOString(),
      )
    },
  )

  it('reports a stale non-terminal run as failed, not running', async () => {
    await seedIssue()

    await service.prisma.experimentRun.create({
      data: {
        organizationSlug: eoOrgSlug,
        experimentType: 'top_community_issues',
        status: ExperimentRunStatus.RUNNING,
        artifactBucket: 'bucket',
        artifactKey: `key-${Date.now()}.json`,
        createdAt: new Date('2020-01-01'),
      },
    })

    const res = await service.client.get<{
      refresh: { status: string; lastCompletedAt: string | null }
    }>(`${BASE}?list=top_community`, eoHeaders())

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.refresh.status).toBe('failed')
  })
})

describe('GET /v1/community-issues — archived priority', () => {
  it('returns prioritized:false when the matching Priority has archivedAt set', async () => {
    const issue = await seedIssue()
    await service.prisma.priority.create({
      data: {
        electedOfficeId: eoId,
        title: 'archived-prio',
        description: 'desc',
        source: 'community_issue',
        sourceCommunityIssueId: issue.id,
        archivedAt: new Date(),
      },
    })
    await seedExperimentRun(
      'top_community_issues',
      ExperimentRunStatus.COMPLETED,
    )

    const res = await service.client.get<{
      issues: { id: string; prioritized: boolean }[]
    }>(`${BASE}?list=top_community`, eoHeaders())

    expect(res.status).toBe(HttpStatus.OK)
    const found = res.data.issues.find((i) => i.id === issue.id)
    expect(found?.prioritized).toBe(false)
  })
})

describe('GET /v1/community-issues/:id — archived', () => {
  it('returns 200 with archived:true for an archived issue', async () => {
    const issue = await seedIssue({
      archivedAt: new Date('2025-01-01'),
    })

    const res = await service.client.get<{ archived: boolean }>(
      `${BASE}/${issue.id}`,
      eoHeaders(),
    )

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.archived).toBe(true)
  })

  it('returns archived:false for an active issue', async () => {
    const issue = await seedIssue()

    const res = await service.client.get<{ archived: boolean }>(
      `${BASE}/${issue.id}`,
      eoHeaders(),
    )

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.archived).toBe(false)
  })
})

describe('GET /v1/community-issues/:id — cross-org security', () => {
  it('returns 404 when the issue belongs to a different org', async () => {
    const otherSlug = `other-org-${uuidv7()}`
    await service.prisma.organization.create({
      data: { slug: otherSlug, ownerId: service.user.id },
    })
    const otherIssue = await seedIssue({ organizationSlug: otherSlug })

    const res = await service.client.get(
      `${BASE}/${otherIssue.id}`,
      eoHeaders(),
    )

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })

  it(
    'returns prioritized:false and priorityId:null when the matching' +
      ' Priority has archivedAt set',
    async () => {
      const issue = await seedIssue()
      await service.prisma.priority.create({
        data: {
          electedOfficeId: eoId,
          title: 'archived-prio',
          description: 'desc',
          source: 'community_issue',
          sourceCommunityIssueId: issue.id,
          archivedAt: new Date(),
        },
      })

      const res = await service.client.get<{
        prioritized: boolean
        priorityId: string | null
      }>(`${BASE}/${issue.id}`, eoHeaders())

      expect(res.status).toBe(HttpStatus.OK)
      expect(res.data.prioritized).toBe(false)
      expect(res.data.priorityId).toBeNull()
    },
  )
})

describe('GET /v1/community-issues/:id', () => {
  it(
    'resolves relatedBriefings via BOTH direct path (communityIssueId)' +
      ' and indirect path (priority.sourceCommunityIssueId -> priorityId)',
    async () => {
      const issue = await seedIssue()

      const briefing = await service.prisma.meetingBriefing.create({
        data: {
          electedOfficeId: eoId,
          meetingDate: new Date('2026-07-01'),
          meetingTime: '18:00',
          meetingTimezone: 'America/New_York',
          experimentRunId: (
            await seedExperimentRun(
              'top_community_issues',
              ExperimentRunStatus.COMPLETED,
            )
          ).runId,
          artifactBucket: 'bucket',
          artifactKey: 'key.json',
          artifact: {
            executive_summary: {
              items: [
                { item_id: 'direct-item', content: 'Direct item content' },
                { item_id: 'indirect-item', content: 'Indirect item content' },
              ],
            },
          },
        },
      })

      await service.prisma.meetingBriefingItemLink.create({
        data: {
          meetingBriefingId: briefing.id,
          briefingItemId: 'direct-item',
          communityIssueId: issue.id,
        },
      })

      const priority = await service.prisma.priority.create({
        data: {
          electedOfficeId: eoId,
          title: 'prio',
          description: 'desc',
          source: 'community_issue',
          sourceCommunityIssueId: issue.id,
        },
      })

      await service.prisma.meetingBriefingItemLink.create({
        data: {
          meetingBriefingId: briefing.id,
          briefingItemId: 'indirect-item',
          priorityId: priority.id,
        },
      })

      const res = await service.client.get<{
        id: string
        prioritized: boolean
        priorityId: string | null
        relatedBriefings: {
          meetingBriefingId: string
          briefingItemId: string
          meetingDate: string
        }[]
      }>(`${BASE}/${issue.id}`, eoHeaders())

      expect(res.status).toBe(HttpStatus.OK)
      expect(res.data.id).toBe(issue.id)
      expect(res.data.prioritized).toBe(true)
      expect(res.data.priorityId).toBe(priority.id)

      const itemIds = res.data.relatedBriefings.map((b) => b.briefingItemId)
      expect(itemIds).toContain('direct-item')
      expect(itemIds).toContain('indirect-item')
      expect(
        res.data.relatedBriefings.every(
          (b) => b.meetingBriefingId === briefing.id,
        ),
      ).toBe(true)
    },
  )

  it(
    'drops relatedBriefing links whose briefingItemId is NOT in the' +
      ' current artifact',
    async () => {
      const issue = await seedIssue()

      const briefing = await service.prisma.meetingBriefing.create({
        data: {
          electedOfficeId: eoId,
          meetingDate: new Date('2026-08-01'),
          meetingTime: '18:00',
          meetingTimezone: 'America/New_York',
          experimentRunId: (
            await seedExperimentRun(
              'top_community_issues',
              ExperimentRunStatus.COMPLETED,
            )
          ).runId,
          artifactBucket: 'bucket',
          artifactKey: 'key2.json',
          artifact: {
            executive_summary: {
              items: [{ item_id: 'valid-item', content: 'Valid item content' }],
            },
          },
        },
      })

      await service.prisma.meetingBriefingItemLink.create({
        data: {
          meetingBriefingId: briefing.id,
          briefingItemId: 'valid-item',
          communityIssueId: issue.id,
        },
      })

      await service.prisma.meetingBriefingItemLink.create({
        data: {
          meetingBriefingId: briefing.id,
          briefingItemId: 'stale-item',
          communityIssueId: issue.id,
        },
      })

      const res = await service.client.get<{
        relatedBriefings: { briefingItemId: string }[]
      }>(`${BASE}/${issue.id}`, eoHeaders())

      expect(res.status).toBe(HttpStatus.OK)
      const itemIds = res.data.relatedBriefings.map((b) => b.briefingItemId)
      expect(itemIds).toContain('valid-item')
      expect(itemIds).not.toContain('stale-item')
    },
  )
})

describe('POST /v1/community-issues/:id/prioritize — archived', () => {
  it('returns 400 when prioritizing an archived issue', async () => {
    const issue = await seedIssue({
      archivedAt: new Date('2025-01-01'),
    })

    const res = await service.client.post(
      `${BASE}/${issue.id}/prioritize`,
      {},
      eoHeaders(),
    )

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
  })

  it('still creates a Priority for an active issue after archived check', async () => {
    const issue = await seedIssue()

    const res = await service.client.post<{ id: string }>(
      `${BASE}/${issue.id}/prioritize`,
      {},
      eoHeaders(),
    )

    expect(res.status).toBe(HttpStatus.CREATED)

    const second = await service.client.post<{ id: string }>(
      `${BASE}/${issue.id}/prioritize`,
      {},
      eoHeaders(),
    )
    expect(second.status).toBe(HttpStatus.CREATED)
    expect(second.data.id).toBe(res.data.id)
  })
})

describe('POST /v1/community-issues/self-dispatch', () => {
  const mockServeContext = (isServeIcp: boolean) =>
    vi
      .spyOn(service.app.get(OrganizationsService), 'resolveServeContext')
      .mockResolvedValue({
        state: 'TX',
        positionName: 'City Council',
        isServeIcp,
      })

  const mockDispatchRun = () =>
    vi
      .spyOn(service.app.get(ExperimentRunsService), 'dispatchRun')
      .mockResolvedValue(undefined)

  it('dispatches a single run for a serve-ICP org owned by a goodparty user', async () => {
    const serveSpy = mockServeContext(true)
    const dispatchSpy = mockDispatchRun()

    const res = await service.client.post<{
      dispatched: number
      skipped: number
    }>(`${BASE}/self-dispatch`, { type: 'top_community_issues' }, eoHeaders())

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.dispatched).toBe(1)
    expect(res.data.skipped).toBe(0)

    const types = dispatchSpy.mock.calls.map((c) => c[0].type)
    expect(types).toEqual(['top_community_issues'])

    serveSpy.mockRestore()
    dispatchSpy.mockRestore()
  })

  it('returns 403 when the caller email is not @goodparty.org', async () => {
    await service.prisma.user.update({
      where: { id: service.user.id },
      data: { email: 'candidate@example.com' },
    })
    const dispatchSpy = mockDispatchRun()

    const res = await service.client.post(
      `${BASE}/self-dispatch`,
      { type: 'top_community_issues' },
      eoHeaders(),
    )

    expect(res.status).toBe(HttpStatus.FORBIDDEN)
    expect(dispatchSpy).not.toHaveBeenCalled()

    dispatchSpy.mockRestore()
  })

  it('returns 404 when the caller has no elected office for the org', async () => {
    const res = await service.client.post(
      `${BASE}/self-dispatch`,
      { type: 'trending_issues' },
      { headers: { 'x-organization-slug': `no-eo-${uuidv7()}` } },
    )

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })

  it('skips (does not dispatch) when the org is not serve-ICP', async () => {
    const serveSpy = mockServeContext(false)
    const dispatchSpy = mockDispatchRun()

    const res = await service.client.post<{
      dispatched: number
      skipped: number
    }>(`${BASE}/self-dispatch`, { type: 'trending_issues' }, eoHeaders())

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.dispatched).toBe(0)
    expect(res.data.skipped).toBe(1)
    expect(dispatchSpy).not.toHaveBeenCalled()

    serveSpy.mockRestore()
    dispatchSpy.mockRestore()
  })
})

describe('POST /v1/community-issues/seed', () => {
  const detail = () => ({
    sources: [
      {
        id: 's1',
        name: 'City Herald',
        retrieved_at: '2026-06-01',
        retrieved_text_or_snapshot: 'snapshot',
        source_type: 'news' as const,
      },
    ],
    overview: { source_ids: ['s1'], summary: 'Overview summary text.' },
  })

  const seedBody = () => ({
    issues: [
      {
        list: 'top_community' as const,
        category: CommunityIssueCategory.housing_and_development,
        priority: CommunityIssuePriority.high,
        title: 'Housing affordability',
        summary: 'Rents are rising.',
        rank: 1,
        detail: detail(),
        relatedBriefing: {
          meetingDate: '2026-07-01',
          briefingItemId: 'item-housing',
          content: 'Council discussed housing.',
        },
      },
      {
        list: 'top_community' as const,
        category: CommunityIssueCategory.public_safety,
        priority: CommunityIssuePriority.medium,
        title: 'Street lighting',
        summary: 'Dark intersections.',
        rank: 2,
        detail: detail(),
      },
      {
        list: 'trending' as const,
        category: CommunityIssueCategory.quality_of_life,
        priority: CommunityIssuePriority.low,
        title: 'Park cleanup',
        summary: 'Litter in the park.',
        rank: 1,
        detail: detail(),
      },
    ],
  })

  it('seeds issues for the caller org, readable via the list + detail reads', async () => {
    const seedRes = await service.client.post<{
      issues: { id: string; list: string; rank: number | null; title: string }[]
    }>(`${BASE}/seed`, seedBody(), eoHeaders())

    expect(seedRes.status).toBe(HttpStatus.CREATED)
    expect(seedRes.data.issues).toHaveLength(3)
    expect(seedRes.data.issues.every((i) => i.id.length > 0)).toBe(true)

    const top = await service.client.get<{
      issues: { id: string; rank: number; title: string }[]
      refresh: { status: string }
    }>(`${BASE}?list=top_community`, eoHeaders())
    expect(top.data.issues.map((i) => i.title)).toEqual([
      'Housing affordability',
      'Street lighting',
    ])
    expect(top.data.refresh.status).toBe('completed')

    const trending = await service.client.get<{
      issues: { title: string }[]
    }>(`${BASE}?list=trending`, eoHeaders())
    expect(trending.data.issues.map((i) => i.title)).toEqual(['Park cleanup'])

    const housingId = seedRes.data.issues.find(
      (i) => i.title === 'Housing affordability',
    )!.id
    const detailRes = await service.client.get<{
      detail: { overview: { summary: string } } | null
      relatedBriefings: { briefingItemId: string; meetingDate: string }[]
    }>(`${BASE}/${housingId}`, eoHeaders())

    expect(detailRes.data.detail?.overview.summary).toBe(
      'Overview summary text.',
    )
    expect(detailRes.data.relatedBriefings).toHaveLength(1)
    expect(detailRes.data.relatedBriefings[0]?.briefingItemId).toBe(
      'item-housing',
    )
    expect(detailRes.data.relatedBriefings[0]?.meetingDate).toBe('2026-07-01')
  })

  it('returns 403 when OTEL_SERVICE_ENVIRONMENT is a customer env (prod)', async () => {
    const prev = process.env.OTEL_SERVICE_ENVIRONMENT
    process.env.OTEL_SERVICE_ENVIRONMENT = 'prod'
    try {
      const res = await service.client.post(
        `${BASE}/seed`,
        seedBody(),
        eoHeaders(),
      )
      expect(res.status).toBe(HttpStatus.FORBIDDEN)
    } finally {
      if (prev === undefined) delete process.env.OTEL_SERVICE_ENVIRONMENT
      else process.env.OTEL_SERVICE_ENVIRONMENT = prev
    }
  })

  it('returns 403 when OTEL_SERVICE_ENVIRONMENT is unknown (fails closed)', async () => {
    const prev = process.env.OTEL_SERVICE_ENVIRONMENT
    process.env.OTEL_SERVICE_ENVIRONMENT = 'staging'
    try {
      const res = await service.client.post(
        `${BASE}/seed`,
        seedBody(),
        eoHeaders(),
      )
      expect(res.status).toBe(HttpStatus.FORBIDDEN)
    } finally {
      if (prev === undefined) delete process.env.OTEL_SERVICE_ENVIRONMENT
      else process.env.OTEL_SERVICE_ENVIRONMENT = prev
    }
  })

  it('rejects more than 10 issues for one list', async () => {
    const base = seedBody().issues[0]!
    const res = await service.client.post(
      `${BASE}/seed`,
      {
        issues: Array.from({ length: 11 }, (_, i) => ({
          ...base,
          relatedBriefing: undefined,
          title: `Issue ${i + 1}`,
          rank: i + 1,
        })),
      },
      eoHeaders(),
    )
    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
  })
})

describe('POST /v1/community-issues/:id/prioritize — cross-org security', () => {
  it('returns 404 when the issue belongs to a different org', async () => {
    const otherSlug = `other-org-${uuidv7()}`
    await service.prisma.organization.create({
      data: { slug: otherSlug, ownerId: service.user.id },
    })
    const otherIssue = await seedIssue({ organizationSlug: otherSlug })

    const res = await service.client.post(
      `${BASE}/${otherIssue.id}/prioritize`,
      {},
      eoHeaders(),
    )

    expect(res.status).toBe(HttpStatus.NOT_FOUND)
  })
})

describe('POST /v1/community-issues/:id/prioritize', () => {
  it('creates a Priority with correct snapshot fields', async () => {
    const issue = await seedIssue()

    const res = await service.client.post<{
      id: string
      title: string
      description: string
      source: string
      electedOfficeId: string
    }>(`${BASE}/${issue.id}/prioritize`, {}, eoHeaders())

    expect(res.status).toBe(HttpStatus.CREATED)
    expect(res.data.title).toBe(issue.title)
    expect(res.data.description).toBe(issue.summary)
    expect(res.data.source).toBe('community_issue')
    expect(res.data.electedOfficeId).toBe(eoId)

    const dbPriority = await service.prisma.priority.findFirst({
      where: { sourceCommunityIssueId: issue.id },
    })
    expect(dbPriority).not.toBeNull()
  })

  it('is idempotent - second call returns existing Priority', async () => {
    const issue = await seedIssue()

    const first = await service.client.post<{ id: string }>(
      `${BASE}/${issue.id}/prioritize`,
      {},
      eoHeaders(),
    )
    const second = await service.client.post<{ id: string }>(
      `${BASE}/${issue.id}/prioritize`,
      {},
      eoHeaders(),
    )

    expect(first.status).toBe(HttpStatus.CREATED)
    expect(second.status).toBe(HttpStatus.CREATED)
    expect(first.data.id).toBe(second.data.id)

    const count = await service.prisma.priority.count({
      where: { sourceCommunityIssueId: issue.id },
    })
    expect(count).toBe(1)
  })
})
