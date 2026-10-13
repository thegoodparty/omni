import { useTestService } from '@/test-service'
import { HttpStatus } from '@nestjs/common'
import { beforeEach, describe, expect, it } from 'vitest'
import { v7 as uuidv7 } from 'uuid'
import type { OnboardingPriorityOptions } from '@goodparty_org/contracts'
import {
  CommunityIssueCategory,
  CommunityIssueList,
  CommunityIssuePriority,
  PrioritySource,
} from '@/generated/prisma'

const service = useTestService()

const PATH = '/v1/priorities/onboarding'

let eoId: string
let eoOrgSlug: string

const eoHeaders = () => ({ headers: { 'x-organization-slug': eoOrgSlug } })

const createIssue = (title: string, rank: number) =>
  service.prisma.communityIssue.create({
    data: {
      organizationSlug: eoOrgSlug,
      list: CommunityIssueList.top_community,
      category: CommunityIssueCategory.housing_and_development,
      priority: CommunityIssuePriority.high,
      title,
      summary: `${title} summary`,
      rank,
    },
  })

const activeTitles = async () =>
  (
    await service.prisma.priority.findMany({
      where: { electedOfficeId: eoId, archivedAt: null },
      orderBy: { title: 'asc' },
    })
  ).map((row) => row.title)

beforeEach(async () => {
  eoId = uuidv7()
  eoOrgSlug = `eo-${eoId}`
  await service.prisma.organization.create({
    data: { slug: eoOrgSlug, ownerId: service.user.id },
  })
  await service.prisma.electedOffice.create({
    data: { id: eoId, userId: service.user.id, organizationSlug: eoOrgSlug },
  })
})

describe('serve onboarding priorities', () => {
  it('offers campaign issues and the top 3 community issues', async () => {
    await service.prisma.priority.create({
      data: {
        electedOfficeId: eoId,
        title: 'Fix the roads',
        description: 'Repave Main St',
        source: PrioritySource.win_import,
      },
    })
    await createIssue('Housing costs', 1)
    await createIssue('Traffic', 2)
    await createIssue('Parks', 3)
    await createIssue('Noise', 4)

    const res = await service.client.get<OnboardingPriorityOptions>(
      PATH,
      eoHeaders(),
    )

    expect(res.status).toBe(HttpStatus.OK)
    expect(
      res.data.options.map(({ kind, title, selected }) => ({
        kind,
        title,
        selected,
      })),
    ).toEqual([
      { kind: 'ran_on', title: 'Fix the roads', selected: true },
      { kind: 'community', title: 'Housing costs', selected: false },
      { kind: 'community', title: 'Traffic', selected: false },
      { kind: 'community', title: 'Parks', selected: false },
    ])
  })

  it('saves the picked issues and keeps every campaign issue', async () => {
    await service.prisma.priority.create({
      data: {
        electedOfficeId: eoId,
        title: 'Fix the roads',
        description: 'Repave Main St',
        source: PrioritySource.win_import,
      },
    })
    await service.prisma.priority.create({
      data: {
        electedOfficeId: eoId,
        title: 'Lower taxes',
        description: '',
        source: PrioritySource.win_import,
      },
    })
    const housing = await createIssue('Housing costs', 1)
    await createIssue('Traffic', 2)

    const res = await service.client.put(
      PATH,
      {
        shownKeys: [housing.id],
        selectedKeys: [housing.id],
        other: [{ title: 'Library hours', description: 'Open on Sundays' }],
      },
      eoHeaders(),
    )

    expect(res.status).toBe(HttpStatus.NO_CONTENT)
    expect(await activeTitles()).toEqual([
      'Fix the roads',
      'Housing costs',
      'Library hours',
      'Lower taxes',
    ])
    const fromIssue = await service.prisma.priority.findFirst({
      where: { sourceCommunityIssueId: housing.id },
    })
    expect(fromIssue?.source).toBe(PrioritySource.community_issue)
  })

  it('reconciles a second save after the official goes back', async () => {
    await service.prisma.priority.create({
      data: {
        electedOfficeId: eoId,
        title: 'Fix the roads',
        description: '',
        source: PrioritySource.win_import,
      },
    })
    const housing = await createIssue('Housing costs', 1)

    await service.client.put(
      PATH,
      {
        shownKeys: [housing.id],
        selectedKeys: [housing.id],
        other: [{ title: 'Library hours', description: 'Open on Sundays' }],
      },
      eoHeaders(),
    )
    const after = await service.client.get<OnboardingPriorityOptions>(
      PATH,
      eoHeaders(),
    )
    const library = after.data.options.find((o) => o.kind === 'other')
    expect(library).toMatchObject({
      title: 'Library hours',
      description: 'Open on Sundays',
    })

    await service.client.put(
      PATH,
      {
        shownKeys: after.data.options.map((o) => o.key),
        selectedKeys: [library?.key ?? ''],
        other: [],
      },
      eoHeaders(),
    )

    expect(await activeTitles()).toEqual(['Fix the roads', 'Library hours'])
  })

  it('does not offer a campaign issue removed from the Priorities page', async () => {
    await service.prisma.priority.create({
      data: {
        electedOfficeId: eoId,
        title: 'Fix the roads',
        description: '',
        source: PrioritySource.win_import,
        archivedAt: new Date(),
      },
    })

    const res = await service.client.get<OnboardingPriorityOptions>(
      PATH,
      eoHeaders(),
    )

    expect(res.data.options).toEqual([])
  })

  it('rejects a typed issue without a reason', async () => {
    const res = await service.client.put(
      PATH,
      {
        shownKeys: [],
        selectedKeys: [],
        other: [{ title: 'Library hours', description: ' ' }],
      },
      eoHeaders(),
    )

    expect(res.status).toBe(HttpStatus.BAD_REQUEST)
    expect(await activeTitles()).toEqual([])
  })

  it('does not duplicate a typed issue that is already a priority', async () => {
    await service.client.put(
      PATH,
      {
        shownKeys: [],
        selectedKeys: [],
        other: [
          { title: 'Library hours', description: 'Open on Sundays' },
          { title: 'library hours ', description: 'Again' },
        ],
      },
      eoHeaders(),
    )

    expect(await activeTitles()).toEqual(['Library hours'])
  })

  it('archives nothing the official was not shown', async () => {
    const housing = await createIssue('Housing costs', 1)
    await service.client.put(
      PATH,
      {
        shownKeys: [housing.id],
        selectedKeys: [housing.id],
        other: [{ title: 'Library hours', description: 'Open on Sundays' }],
      },
      eoHeaders(),
    )

    const res = await service.client.put(
      PATH,
      {
        shownKeys: [],
        selectedKeys: [],
        other: [{ title: 'Park lighting', description: 'Safer at night' }],
      },
      eoHeaders(),
    )

    expect(res.status).toBe(HttpStatus.NO_CONTENT)
    expect(await activeTitles()).toEqual([
      'Housing costs',
      'Library hours',
      'Park lighting',
    ])
  })
})
