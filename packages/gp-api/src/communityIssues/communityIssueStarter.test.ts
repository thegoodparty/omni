import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { v7 as uuidv7 } from 'uuid'
import {
  CommunityIssueCategory,
  CommunityIssueList,
  CommunityIssuePriority,
} from '../generated/prisma'
import { useTestService } from '@/test-service'
import { OrganizationsService } from '@/organizations/services/organizations.service'
import { GeminiService } from '@/vendors/google/services/gemini.service'
import { CommunityIssueDispatchService } from './services/communityIssueDispatch.service'

const service = useTestService()

const PATH = '/v1/community-issues/onboarding'

let eoOrgSlug: string

const eoHeaders = () => ({ headers: { 'x-organization-slug': eoOrgSlug } })

const structuredSpy = () => service.app.get(GeminiService).generateStructured
const dispatchSpy = () =>
  service.app.get(CommunityIssueDispatchService).onElectedOfficeCreated

const STARTER_ISSUES = {
  issues: [
    {
      title: 'Route 3 apartment proposal',
      summary: 'Residents packed a hearing over a 40-unit plan on Route 3.',
      category: CommunityIssueCategory.housing_and_development,
      priority: CommunityIssuePriority.high,
      sources: [
        {
          name: 'Residents push back on Route 3 plan',
          url: 'https://news.example.com/route-3',
          publisher: 'Maplewood Gazette',
          article_date: '2026-09-01',
        },
      ],
    },
    {
      title: 'Unsourced rumor',
      summary: 'Nothing backs this up.',
      category: CommunityIssueCategory.other,
      priority: CommunityIssuePriority.low,
      sources: [{ name: 'No link', url: 'not a url' }],
    },
  ],
}

beforeEach(async () => {
  const id = uuidv7()
  eoOrgSlug = `eo-${id}`
  await service.prisma.organization.create({
    data: { slug: eoOrgSlug, ownerId: service.user.id },
  })
  await service.prisma.electedOffice.create({
    data: { id, userId: service.user.id, organizationSlug: eoOrgSlug },
  })

  vi.spyOn(
    service.app.get(OrganizationsService),
    'resolveServeContext',
  ).mockResolvedValue({ state: 'MN', positionName: 'Maplewood City Council' })
  vi.spyOn(
    service.app.get(GeminiService),
    'generateWithSearch',
  ).mockResolvedValue({
    text: 'search results',
    searchQueries: [],
    sources: [],
  })
  vi.spyOn(
    service.app.get(GeminiService),
    'generateStructured',
  ).mockResolvedValue(STARTER_ISSUES)
  vi.spyOn(
    service.app.get(CommunityIssueDispatchService),
    'onElectedOfficeCreated',
  ).mockResolvedValue(undefined)
})

describe('community issues onboarding start', () => {
  it('writes sourced starter issues, then dispatches the full runs', async () => {
    const res = await service.client.post<{ starterIssueCount: number }>(
      PATH,
      {},
      eoHeaders(),
    )

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.starterIssueCount).toBe(1)
    const rows = await service.prisma.communityIssue.findMany({
      where: { organizationSlug: eoOrgSlug },
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      list: CommunityIssueList.top_community,
      title: 'Route 3 apartment proposal',
      rank: 1,
      lastRefreshedRunId: null,
    })
    expect(rows[0]?.detail).toMatchObject({
      sources: [{ id: 's1', url: 'https://news.example.com/route-3' }],
      overview: { source_ids: ['s1'] },
    })
    expect(dispatchSpy()).toHaveBeenCalledTimes(1)
  })

  it('leaves an existing top list alone', async () => {
    await service.prisma.communityIssue.create({
      data: {
        organizationSlug: eoOrgSlug,
        list: CommunityIssueList.top_community,
        category: CommunityIssueCategory.public_safety,
        priority: CommunityIssuePriority.high,
        title: 'Already here',
        summary: 'From a full run.',
        rank: 1,
      },
    })

    const res = await service.client.post<{ starterIssueCount: number }>(
      PATH,
      {},
      eoHeaders(),
    )

    expect(res.data.starterIssueCount).toBe(0)
    expect(structuredSpy()).not.toHaveBeenCalled()
    expect(
      await service.prisma.communityIssue.count({
        where: { organizationSlug: eoOrgSlug },
      }),
    ).toBe(1)
  })

  it('still dispatches the full runs when the quick search fails', async () => {
    vi.mocked(structuredSpy()).mockRejectedValue(new Error('Gemini down'))

    const res = await service.client.post<{ starterIssueCount: number }>(
      PATH,
      {},
      eoHeaders(),
    )

    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.starterIssueCount).toBe(0)
    expect(dispatchSpy()).toHaveBeenCalledTimes(1)
  })

  it('runs one generation for concurrent starts on the same org', async () => {
    const [first, second] = await Promise.all([
      service.client.post<{ starterIssueCount: number }>(PATH, {}, eoHeaders()),
      service.client.post<{ starterIssueCount: number }>(PATH, {}, eoHeaders()),
    ])

    expect(first.status).toBe(HttpStatus.OK)
    expect(second.status).toBe(HttpStatus.OK)
    expect(structuredSpy()).toHaveBeenCalledTimes(1)
    expect(
      await service.prisma.communityIssue.count({
        where: { organizationSlug: eoOrgSlug },
      }),
    ).toBe(1)
  })
})
