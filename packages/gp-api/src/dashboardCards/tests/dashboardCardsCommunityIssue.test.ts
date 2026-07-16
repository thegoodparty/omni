import { addDays } from 'date-fns'
import { describe, expect, it } from 'vitest'
import {
  CommunityIssue,
  CommunityIssueCategory,
  CommunityIssueList,
  CommunityIssuePriority,
} from '../../generated/prisma'
import { useTestService } from '@/test-service'
import { DashboardCardsService } from '../services/dashboardCards.service'

const service = useTestService()

const sync = () => service.app.get(DashboardCardsService)

const seedElectedOffice = async (orgSlug: string) => {
  await service.prisma.organization.create({
    data: { slug: orgSlug, ownerId: service.user.id },
  })
  return service.prisma.electedOffice.create({
    data: { organizationSlug: orgSlug, userId: service.user.id },
  })
}

const seedIssue = (orgSlug: string): Promise<CommunityIssue> =>
  service.prisma.communityIssue.create({
    data: {
      organizationSlug: orgSlug,
      list: CommunityIssueList.trending,
      category: CommunityIssueCategory.public_safety,
      priority: CommunityIssuePriority.high,
      title: 'Speeding on Main St',
      summary: 'Residents report frequent speeding near the school.',
    },
  })

describe('DashboardCardsService.syncFromCommunityIssue', () => {
  it('creates a community_issue card with issue content, CTA and 7-day due date', async () => {
    const orgSlug = 'eo-ci-card-create'
    const eo = await seedElectedOffice(orgSlug)
    const issue = await seedIssue(orgSlug)

    await sync().syncFromCommunityIssue(eo.id, issue)

    const card = await service.prisma.dashboardCard.findFirstOrThrow({
      where: { electedOfficeId: eo.id, type: 'community_issue' },
    })
    expect(card).toMatchObject({
      title: 'Speeding on Main St',
      summary: 'Residents report frequent speeding near the school.',
      ctaLabel: 'View issue',
      ctaHref: `/dashboard/community-issues/${issue.id}`,
      sourceExternalId: issue.id,
      sourceItemId: null,
    })
    expect(card.dueDate).toEqual(addDays(issue.createdAt, 7))
  })

  it('is idempotent: a repeat call for the same issue makes no duplicate', async () => {
    const orgSlug = 'eo-ci-card-idempotent'
    const eo = await seedElectedOffice(orgSlug)
    const issue = await seedIssue(orgSlug)

    await sync().syncFromCommunityIssue(eo.id, issue)
    await sync().syncFromCommunityIssue(eo.id, issue)

    const count = await service.prisma.dashboardCard.count({
      where: { electedOfficeId: eo.id, type: 'community_issue' },
    })
    expect(count).toBe(1)
  })
})
