import { useTestService } from '@/test-service'
import { beforeEach, describe, expect, it } from 'vitest'
import { v7 as uuidv7 } from 'uuid'
import { CommunityIssueReadService } from '@/communityIssues/services/communityIssueRead.service'
import {
  CommunityIssueCategory,
  CommunityIssueList,
  CommunityIssuePriority,
} from '../../../../generated/prisma'
import { CommunityIssueReadAdapter } from './communityIssueRead.adapter'
import { buildReadCommunityIssuesTool } from './communityIssueRead.tool'

const service = useTestService()

let officeId: string
let orgSlug: string

const seedIssue = (list: CommunityIssueList, rank: number, title: string) =>
  service.prisma.communityIssue.create({
    data: {
      organizationSlug: orgSlug,
      list,
      category: CommunityIssueCategory.public_safety,
      priority: CommunityIssuePriority.high,
      title,
      summary: `${title} summary`,
      detail: { overview: { summary: 'ok' }, sources: [] },
      rank,
    },
  })

const buildTool = () =>
  buildReadCommunityIssuesTool({
    port: new CommunityIssueReadAdapter(
      service.app.get(CommunityIssueReadService),
    ),
    organizationSlug: orgSlug,
    electedOfficeId: officeId,
  })

beforeEach(async () => {
  officeId = uuidv7()
  orgSlug = `eo-cir-${officeId}`
  await service.prisma.organization.create({
    data: { slug: orgSlug, ownerId: service.user.id },
  })
  await service.prisma.electedOffice.create({
    data: { id: officeId, userId: service.user.id, organizationSlug: orgSlug },
  })
})

describe('CommunityIssueReadAdapter', () => {
  it('lists both lists for the office, compact, with the prioritized flag', async () => {
    const top = await seedIssue(CommunityIssueList.top_community, 1, 'Roads')
    const trending = await seedIssue(CommunityIssueList.trending, 1, 'Parks')
    await service.prisma.priority.create({
      data: {
        electedOfficeId: officeId,
        title: 'Roads',
        description: 'desc',
        source: 'community_issue',
        sourceCommunityIssueId: trending.id,
      },
    })

    const result = await buildTool().execute({})

    expect(result).toEqual({
      issues: [
        {
          id: top.id,
          list: 'top_community',
          title: 'Roads',
          summary: 'Roads summary',
          category: 'public_safety',
          rank: 1,
          prioritized: false,
        },
        {
          id: trending.id,
          list: 'trending',
          title: 'Parks',
          summary: 'Parks summary',
          category: 'public_safety',
          rank: 1,
          prioritized: true,
        },
      ],
    })
  })

  it('returns an empty list for an office with no issues', async () => {
    expect(await buildTool().execute({})).toEqual({ issues: [] })
  })

  it('reads an id from the list in full', async () => {
    const issue = await seedIssue(CommunityIssueList.top_community, 1, 'Roads')
    const result = await buildTool().execute({ id: issue.id })
    expect(result).toMatchObject({ id: issue.id, title: 'Roads' })
  })

  it('returns the error object for an id that is not in the org', async () => {
    expect(await buildTool().execute({ id: uuidv7() })).toEqual({
      error:
        'No community issue with that id. Call read_community_issues without an id to list them.',
    })
  })
})
