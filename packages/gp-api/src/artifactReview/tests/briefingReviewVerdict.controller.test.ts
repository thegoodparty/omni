import { describe, expect, it } from 'vitest'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { ExperimentRunStatus } from '../../generated/prisma'
import { useTestService } from '@/test-service'
import { BriefingReviewVerdictService } from '../services/briefingReviewVerdict.service'

const service = useTestService()

const ACTOR_SUB = 'user_admin_999'

const seedElectedOffice = async (orgSlug: string) => {
  await service.prisma.organization.create({
    data: { slug: orgSlug, ownerId: service.user.id },
  })
  return service.prisma.electedOffice.create({
    data: { organizationSlug: orgSlug, userId: service.user.id },
  })
}

const seedBriefing = async (
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
      artifactBucket: 'briefing-bucket',
      artifactKey: `${meetingDate}.json`,
    },
  })
}

const seedReviewComment = (briefingId: string) =>
  service.prisma.annotation.create({
    data: {
      author: { connect: { id: service.user.id } },
      kind: 'review',
      resourceType: 'briefing',
      resourceId: briefingId,
      annotationReview: {
        create: { body: 'fix this', reviewerClerkSub: ACTOR_SUB },
      },
    },
  })

const orgHeader = (slug: string) => ({
  headers: { 'x-organization-slug': slug },
})

const actorAdmin = async (email: string) =>
  service.prisma.user.create({
    data: {
      clerkId: ACTOR_SUB,
      email,
      firstName: 'Admin',
      lastName: 'Reviewer',
    },
  })

describe('briefing review verdict — default-deny over HTTP (no actor)', () => {
  it('rejects setting a verdict without an impersonation actor', async () => {
    const orgSlug = 'eo-verdict-noactor'
    const eo = await seedElectedOffice(orgSlug)
    await seedBriefing(eo.id, orgSlug, '2026-06-08')

    const result = await service.client.put(
      '/v1/meetings/2026-06-08/briefing/review-verdict',
      { verdict: 'passed' },
      orgHeader(orgSlug),
    )

    expect(result.status).toBe(403)
  })

  it('rejects reading a verdict without an impersonation actor', async () => {
    const orgSlug = 'eo-verdict-get-noactor'
    const eo = await seedElectedOffice(orgSlug)
    await seedBriefing(eo.id, orgSlug, '2026-06-08')

    const result = await service.client.get(
      '/v1/meetings/2026-06-08/briefing/review-verdict',
      orgHeader(orgSlug),
    )

    expect(result.status).toBe(403)
  })
})

// The service takes actorSub/actorUser explicitly (the guard populates them
// in production) — same pattern as the AnnotationsService actor tests.
describe('BriefingReviewVerdictService — verdicts with an actor', () => {
  it('passes a briefing and reads it back', async () => {
    const verdicts = service.app.get(BriefingReviewVerdictService)
    const orgSlug = 'eo-verdict-pass'
    const eo = await seedElectedOffice(orgSlug)
    const briefing = await seedBriefing(eo.id, orgSlug, '2026-06-08')
    const admin = await actorAdmin('reviewer-pass@goodparty.org')

    const created = await verdicts.setForBriefing({
      meetingDate: '2026-06-08',
      electedOffice: eo,
      actorSub: ACTOR_SUB,
      actorUser: admin,
      verdict: 'passed',
    })

    expect(created.verdict).toBe('passed')
    expect(created.failReason).toBeNull()
    expect(created.reviewerEmail).toBe('reviewer-pass@goodparty.org')

    const row = await service.prisma.artifactReview.findUnique({
      where: {
        resourceType_resourceId: {
          resourceType: 'briefing',
          resourceId: briefing.id,
        },
      },
    })
    expect(row?.reviewerClerkSub).toBe(ACTOR_SUB)

    const fetched = await verdicts.getForBriefing('2026-06-08', eo, ACTOR_SUB)
    expect(fetched?.verdict).toBe('passed')
  })

  it('rejects failing with no reason and no review comments', async () => {
    const verdicts = service.app.get(BriefingReviewVerdictService)
    const orgSlug = 'eo-verdict-fail-bare'
    const eo = await seedElectedOffice(orgSlug)
    await seedBriefing(eo.id, orgSlug, '2026-06-08')
    const admin = await actorAdmin('reviewer-bare@goodparty.org')

    await expect(
      verdicts.setForBriefing({
        meetingDate: '2026-06-08',
        electedOffice: eo,
        actorSub: ACTOR_SUB,
        actorUser: admin,
        verdict: 'failed',
      }),
    ).rejects.toThrow(BadRequestException)
  })

  it('allows failing without a reason when review comments exist', async () => {
    const verdicts = service.app.get(BriefingReviewVerdictService)
    const orgSlug = 'eo-verdict-fail-comments'
    const eo = await seedElectedOffice(orgSlug)
    const briefing = await seedBriefing(eo.id, orgSlug, '2026-06-08')
    await seedReviewComment(briefing.id)
    const admin = await actorAdmin('reviewer-comments@goodparty.org')

    const created = await verdicts.setForBriefing({
      meetingDate: '2026-06-08',
      electedOffice: eo,
      actorSub: ACTOR_SUB,
      actorUser: admin,
      verdict: 'failed',
    })

    expect(created.verdict).toBe('failed')
  })

  it('allows failing with a reason and clears it on a later pass', async () => {
    const verdicts = service.app.get(BriefingReviewVerdictService)
    const orgSlug = 'eo-verdict-overwrite'
    const eo = await seedElectedOffice(orgSlug)
    await seedBriefing(eo.id, orgSlug, '2026-06-08')
    const admin = await actorAdmin('reviewer-overwrite@goodparty.org')

    const failed = await verdicts.setForBriefing({
      meetingDate: '2026-06-08',
      electedOffice: eo,
      actorSub: ACTOR_SUB,
      actorUser: admin,
      verdict: 'failed',
      failReason: 'Summary is wrong',
    })
    expect(failed.failReason).toBe('Summary is wrong')

    const passed = await verdicts.setForBriefing({
      meetingDate: '2026-06-08',
      electedOffice: eo,
      actorSub: ACTOR_SUB,
      actorUser: admin,
      verdict: 'passed',
    })
    expect(passed.verdict).toBe('passed')
    expect(passed.failReason).toBeNull()
  })

  it('rejects setting a verdict for a date with no briefing', async () => {
    const verdicts = service.app.get(BriefingReviewVerdictService)
    const orgSlug = 'eo-verdict-no-briefing'
    const eo = await seedElectedOffice(orgSlug)
    const admin = await actorAdmin('reviewer-nobriefing@goodparty.org')

    await expect(
      verdicts.setForBriefing({
        meetingDate: '2026-01-01',
        electedOffice: eo,
        actorSub: ACTOR_SUB,
        actorUser: admin,
        verdict: 'passed',
      }),
    ).rejects.toThrow(NotFoundException)
  })

  it('returns null when no verdict exists', async () => {
    const verdicts = service.app.get(BriefingReviewVerdictService)
    const orgSlug = 'eo-verdict-none'
    const eo = await seedElectedOffice(orgSlug)
    await seedBriefing(eo.id, orgSlug, '2026-06-08')

    const fetched = await verdicts.getForBriefing('2026-06-08', eo, ACTOR_SUB)
    expect(fetched).toBeNull()
  })
})
