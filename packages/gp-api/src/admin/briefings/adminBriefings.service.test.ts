import { describe, expect, it } from 'vitest'
import { ExperimentRunStatus } from '../../generated/prisma'
import { useTestService } from '@/test-service'
import { AdminBriefingsService } from './services/adminBriefings.service'

const service = useTestService()

const seedBriefing = async ({
  orgSlug,
  userId,
  meetingDate,
  meetingName,
  customPositionName,
}: {
  orgSlug: string
  userId: number
  meetingDate: string
  meetingName?: string
  customPositionName?: string
}) => {
  await service.prisma.organization.create({
    data: { slug: orgSlug, ownerId: userId, customPositionName },
  })
  const eo = await service.prisma.electedOffice.create({
    data: { organizationSlug: orgSlug, userId },
  })
  const run = await service.prisma.experimentRun.create({
    data: {
      organizationSlug: orgSlug,
      experimentType: 'meeting_briefing',
      status: ExperimentRunStatus.COMPLETED,
    },
  })
  return service.prisma.meetingBriefing.create({
    data: {
      electedOfficeId: eo.id,
      meetingDate: new Date(meetingDate + 'T00:00:00Z'),
      meetingTime: '19:00',
      meetingTimezone: 'America/Denver',
      experimentRunId: run.runId,
      artifactBucket: 'b',
      artifactKey: `${meetingDate}.json`,
      artifact: meetingName ? { meeting_name: meetingName } : undefined,
    },
  })
}

const seedElectedOffice = async (orgSlug: string) => {
  await service.prisma.organization.create({
    data: { slug: orgSlug, ownerId: service.user.id },
  })
  return service.prisma.electedOffice.create({
    data: { organizationSlug: orgSlug, userId: service.user.id },
  })
}

const seedBriefingForOffice = async (
  eoId: string,
  orgSlug: string,
  meetingDate: string,
) => {
  const run = await service.prisma.experimentRun.create({
    data: {
      organizationSlug: orgSlug,
      experimentType: 'meeting_briefing',
      status: ExperimentRunStatus.COMPLETED,
    },
  })
  return service.prisma.meetingBriefing.create({
    data: {
      electedOfficeId: eoId,
      meetingDate: new Date(meetingDate + 'T00:00:00Z'),
      meetingTime: '19:00',
      meetingTimezone: 'America/Denver',
      experimentRunId: run.runId,
      artifactBucket: 'b',
      artifactKey: `${meetingDate}.json`,
    },
  })
}

describe('AdminBriefingsService.list', () => {
  it('returns rows joined to the owning user and office', async () => {
    const briefings = service.app.get(AdminBriefingsService)
    const briefing = await seedBriefing({
      orgSlug: 'eo-admin-list',
      userId: service.user.id,
      meetingDate: '2026-06-09',
      meetingName: 'City Council Regular Session',
      customPositionName: 'City Council Member',
    })

    const result = await briefings.list({})

    const row = result.data.find((r) => r.briefingId === briefing.id)
    expect(row).toBeDefined()
    expect(row?.meetingDate).toBe('2026-06-09')
    expect(row?.meetingName).toBe('City Council Regular Session')
    expect(row?.user.id).toBe(service.user.id)
    expect(row?.electedOffice.organizationSlug).toBe('eo-admin-list')
    expect(row?.electedOffice.positionName).toBe('City Council Member')
  })

  it('filters by fuzzy name/email query', async () => {
    const briefings = service.app.get(AdminBriefingsService)
    const match = await service.prisma.user.create({
      data: {
        clerkId: 'admin_q_match',
        email: 'zelda@goodparty.org',
        firstName: 'Zelda',
        lastName: 'Fitzgerald',
      },
    })
    await seedBriefing({
      orgSlug: 'eo-q-match',
      userId: match.id,
      meetingDate: '2026-06-10',
    })

    const result = await briefings.list({ q: 'zelda' })

    expect(result.data.length).toBeGreaterThan(0)
    expect(
      result.data.every((r) => r.user.email === 'zelda@goodparty.org'),
    ).toBe(true)
  })
})

describe('review verdicts on admin rows', () => {
  it('zips the verdict onto the row and null when unreviewed', async () => {
    const svc = service.app.get(AdminBriefingsService)
    const orgSlug = 'eo-admin-review-zip'
    const eo = await seedElectedOffice(orgSlug)
    const reviewed = await seedBriefingForOffice(eo.id, orgSlug, '2026-06-08')
    const pending = await seedBriefingForOffice(eo.id, orgSlug, '2026-06-09')

    await service.prisma.artifactReview.create({
      data: {
        resourceType: 'briefing',
        resourceId: reviewed.id,
        verdict: 'failed',
        failReason: 'Bad summary',
        reviewerClerkSub: 'user_admin_1',
        reviewerEmail: 'rev@goodparty.org',
      },
    })

    const { data } = await svc.list({})
    const reviewedRow = data.find((r) => r.briefingId === reviewed.id)
    const pendingRow = data.find((r) => r.briefingId === pending.id)

    expect(reviewedRow?.review).toMatchObject({
      verdict: 'failed',
      failReason: 'Bad summary',
      reviewerEmail: 'rev@goodparty.org',
    })
    expect(pendingRow?.review).toBeNull()
  })

  it('filters by review status', async () => {
    const svc = service.app.get(AdminBriefingsService)
    const orgSlug = 'eo-admin-review-filter'
    const eo = await seedElectedOffice(orgSlug)
    const passed = await seedBriefingForOffice(eo.id, orgSlug, '2026-06-10')
    const pending = await seedBriefingForOffice(eo.id, orgSlug, '2026-06-11')

    await service.prisma.artifactReview.create({
      data: {
        resourceType: 'briefing',
        resourceId: passed.id,
        verdict: 'passed',
        reviewerClerkSub: 'user_admin_1',
      },
    })

    const passedList = await svc.list({ reviewStatus: 'passed' })
    expect(passedList.data.map((r) => r.briefingId)).toContain(passed.id)
    expect(passedList.data.map((r) => r.briefingId)).not.toContain(pending.id)

    const pendingList = await svc.list({ reviewStatus: 'pending' })
    expect(pendingList.data.map((r) => r.briefingId)).toContain(pending.id)
    expect(pendingList.data.map((r) => r.briefingId)).not.toContain(passed.id)
  })
})
