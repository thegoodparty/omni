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

const service = useTestService({ jobs: true })

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
  it('answers before the paid search, then writes starter issues and dispatches the full runs', async () => {
    let releaseSearch: () => void = () => undefined
    const searchHeld = new Promise<void>((resolve) => {
      releaseSearch = resolve
    })
    vi.mocked(structuredSpy()).mockImplementation(async () => {
      await searchHeld
      return STARTER_ISSUES
    })

    const res = await service.client.post<{ queued: boolean }>(
      PATH,
      {},
      eoHeaders(),
    )

    // The response is out while the search is still blocked: the route no
    // longer holds the browser for the generation.
    expect(res.status).toBe(HttpStatus.OK)
    expect(res.data.queued).toBe(true)
    expect(
      await service.prisma.communityIssue.count({
        where: { organizationSlug: eoOrgSlug },
      }),
    ).toBe(0)

    releaseSearch()
    await service.jobs.settle()

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

    await service.client.post(PATH, {}, eoHeaders())
    await service.jobs.settle()

    expect(structuredSpy()).not.toHaveBeenCalled()
    expect(
      await service.prisma.communityIssue.count({
        where: { organizationSlug: eoOrgSlug },
      }),
    ).toBe(1)
  })

  it('still dispatches the full runs when the quick search fails', async () => {
    vi.mocked(structuredSpy()).mockRejectedValue(new Error('Gemini down'))

    await service.client.post(PATH, {}, eoHeaders())
    await service.jobs.settle()

    expect(
      await service.prisma.communityIssue.count({
        where: { organizationSlug: eoOrgSlug },
      }),
    ).toBe(0)
    expect(dispatchSpy()).toHaveBeenCalledTimes(1)
  })

  it('runs one generation for concurrent starts on the same org', async () => {
    const [first, second] = await Promise.all([
      service.client.post(PATH, {}, eoHeaders()),
      service.client.post(PATH, {}, eoHeaders()),
    ])

    expect(first.status).toBe(HttpStatus.OK)
    expect(second.status).toBe(HttpStatus.OK)
    await service.jobs.settle()

    // The dispatch runs once per job, so this is what the org-slug key buys:
    // seed guards the generation itself (inFlight, then hasTopList), so those
    // two counts hold even with two jobs.
    expect(dispatchSpy()).toHaveBeenCalledTimes(1)
    expect(structuredSpy()).toHaveBeenCalledTimes(1)
    expect(
      await service.prisma.communityIssue.count({
        where: { organizationSlug: eoOrgSlug },
      }),
    ).toBe(1)
  })
})
