import { ExperimentRunStatus } from '../../generated/prisma'
import { describe, expect, it, vi } from 'vitest'
import { useTestService } from '@/test-service'
import { S3Service } from '@/vendors/aws/services/s3.service'
import { MeetingBriefingsService } from './meetingBriefings.service'

const service = useTestService()

const mockS3 = (responses: Record<string, string | undefined>) => {
  vi.spyOn(service.app.get(S3Service), 'getFile').mockImplementation(
    async (_bucket, key) => responses[key],
  )
}

const seedOrgAndElectedOffice = async (orgSlug: string) => {
  await service.prisma.organization.create({
    data: { slug: orgSlug, ownerId: service.user.id },
  })
  return service.prisma.electedOffice.create({
    data: { organizationSlug: orgSlug, userId: service.user.id },
  })
}

const seedBriefingRun = (
  orgSlug: string,
  artifactKey: string,
  electedOfficeId: string,
) =>
  service.prisma.experimentRun.create({
    data: {
      organizationSlug: orgSlug,
      experimentType: 'meeting_briefing',
      status: ExperimentRunStatus.COMPLETED,
      artifactBucket: 'briefing-bucket',
      artifactKey,
      params: { elected_office_id: electedOfficeId },
    },
  })

const baseArtifact = {
  briefing_status: 'briefing_ready',
  meeting_date: '2026-07-15',
  meeting_time: '19:00',
  meeting_timezone: 'America/Chicago',
  meeting_name: 'City Council',
  location: 'Council Chambers',
  disclosure: 'AI-generated briefing.',
  briefing_type: 'city_council_meeting',
  estimated_read_minutes: 5,
  claims: [],
  items: [],
  sources: [],
  run_metadata: { run_decisions: [] },
}

describe('briefingItemLinks: item link writing from stamped artifact', () => {
  it(
    'writes link rows for items stamped with valid org priority_id and' +
      ' community_issue_id',
    async () => {
      const suffix = Date.now()
      const orgSlug = `bil-valid-${suffix}`
      const eo = await seedOrgAndElectedOffice(orgSlug)

      const priority = await service.prisma.priority.create({
        data: {
          electedOfficeId: eo.id,
          title: 'Fix roads',
          description: 'Fix the roads',
          source: 'user_stated',
        },
      })
      const feed = await service.prisma.communityIssue.create({
        data: {
          organizationSlug: orgSlug,
          list: 'top_community',
          category: 'infrastructure_and_transportation',
          priority: 'high',
          title: 'Road safety',
          summary: 'Road safety is important',
        },
      })

      const artifactKey = `bil-valid-${suffix}.json`
      const run = await seedBriefingRun(orgSlug, artifactKey, eo.id)

      mockS3({
        [artifactKey]: JSON.stringify({
          ...baseArtifact,
          executive_summary: {
            lead_in: 'Two items today.',
            items: [
              {
                item_id: 'item_001',
                overview: 'Road repairs.',
                priority_id: priority.id,
              },
              {
                item_id: 'item_002',
                overview: 'Community issue.',
                community_issue_id: feed.id,
              },
            ],
          },
        }),
      })

      await service.app
        .get(MeetingBriefingsService)
        .onExperimentRunCompleted(run)

      const briefing = await service.prisma.meetingBriefing.findUnique({
        where: {
          electedOfficeId_meetingDate: {
            electedOfficeId: eo.id,
            meetingDate: new Date('2026-07-15'),
          },
        },
      })
      expect(briefing).not.toBeNull()

      const links = await service.prisma.meetingBriefingItemLink.findMany({
        where: { meetingBriefingId: briefing!.id },
        orderBy: { briefingItemId: 'asc' },
      })

      expect(links).toHaveLength(2)
      expect(links[0]).toMatchObject({
        briefingItemId: 'item_001',
        priorityId: priority.id,
        communityIssueId: null,
      })
      expect(links[1]).toMatchObject({
        briefingItemId: 'item_002',
        priorityId: null,
        communityIssueId: feed.id,
      })
    },
  )

  it('drops a stamped id that belongs to a foreign org (not inserted)', async () => {
    const suffix = Date.now()
    const orgSlug = `bil-foreign-${suffix}`
    const eo = await seedOrgAndElectedOffice(orgSlug)

    const otherOrgSlug = `bil-other-${suffix}`
    const otherOwner = await service.prisma.user.create({
      data: { email: `bil-other-${suffix}@example.com` },
    })
    await service.prisma.organization.create({
      data: { slug: otherOrgSlug, ownerId: otherOwner.id },
    })
    const otherEo = await service.prisma.electedOffice.create({
      data: { organizationSlug: otherOrgSlug, userId: otherOwner.id },
    })
    const foreignPriority = await service.prisma.priority.create({
      data: {
        electedOfficeId: otherEo.id,
        title: 'Foreign priority',
        description: 'Not our org',
        source: 'user_stated',
      },
    })

    const validFeed = await service.prisma.communityIssue.create({
      data: {
        organizationSlug: orgSlug,
        list: 'top_community',
        category: 'public_safety',
        priority: 'medium',
        title: 'Safety first',
        summary: 'Local community issue',
      },
    })

    const artifactKey = `bil-foreign-${suffix}.json`
    const run = await seedBriefingRun(orgSlug, artifactKey, eo.id)

    mockS3({
      [artifactKey]: JSON.stringify({
        ...baseArtifact,
        executive_summary: {
          lead_in: 'Two items.',
          items: [
            {
              item_id: 'item_001',
              overview: 'Foreign priority item.',
              priority_id: foreignPriority.id,
            },
            {
              item_id: 'item_002',
              overview: 'Valid feed item.',
              community_issue_id: validFeed.id,
            },
          ],
        },
      }),
    })

    await service.app.get(MeetingBriefingsService).onExperimentRunCompleted(run)

    const briefing = await service.prisma.meetingBriefing.findUnique({
      where: {
        electedOfficeId_meetingDate: {
          electedOfficeId: eo.id,
          meetingDate: new Date('2026-07-15'),
        },
      },
    })
    expect(briefing).not.toBeNull()

    const links = await service.prisma.meetingBriefingItemLink.findMany({
      where: { meetingBriefingId: briefing!.id },
    })

    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({
      briefingItemId: 'item_002',
      priorityId: null,
      communityIssueId: validFeed.id,
    })
  })

  it('delete-and-reinserts on regeneration — no stale rows survive', async () => {
    const suffix = Date.now()
    const orgSlug = `bil-regen-${suffix}`
    const eo = await seedOrgAndElectedOffice(orgSlug)

    const priority = await service.prisma.priority.create({
      data: {
        electedOfficeId: eo.id,
        title: 'Old priority',
        description: 'Was relevant once',
        source: 'user_stated',
      },
    })
    const newFeed = await service.prisma.communityIssue.create({
      data: {
        organizationSlug: orgSlug,
        list: 'trending',
        category: 'education',
        priority: 'low',
        title: 'School funding',
        summary: 'Latest topic',
      },
    })

    const artifactKey = `bil-regen-${suffix}.json`

    // First run: item_001 stamped with priority
    const run1 = await seedBriefingRun(orgSlug, artifactKey, eo.id)
    mockS3({
      [artifactKey]: JSON.stringify({
        ...baseArtifact,
        executive_summary: {
          lead_in: 'First run.',
          items: [
            {
              item_id: 'item_001',
              overview: 'Old priority item.',
              priority_id: priority.id,
            },
          ],
        },
      }),
    })

    await service.app
      .get(MeetingBriefingsService)
      .onExperimentRunCompleted(run1)

    const briefing = await service.prisma.meetingBriefing.findUnique({
      where: {
        electedOfficeId_meetingDate: {
          electedOfficeId: eo.id,
          meetingDate: new Date('2026-07-15'),
        },
      },
    })
    expect(briefing).not.toBeNull()

    const linksAfterFirst =
      await service.prisma.meetingBriefingItemLink.findMany({
        where: { meetingBriefingId: briefing!.id },
      })
    expect(linksAfterFirst).toHaveLength(1)
    expect(linksAfterFirst[0]?.briefingItemId).toBe('item_001')

    // Second run: item_002 stamped with community_issue_id only
    const run2 = await service.prisma.experimentRun.create({
      data: {
        organizationSlug: orgSlug,
        experimentType: 'meeting_briefing',
        status: ExperimentRunStatus.COMPLETED,
        artifactBucket: 'briefing-bucket',
        artifactKey,
        params: { elected_office_id: eo.id },
      },
    })
    mockS3({
      [artifactKey]: JSON.stringify({
        ...baseArtifact,
        executive_summary: {
          lead_in: 'Second run.',
          items: [
            {
              item_id: 'item_002',
              overview: 'New feed item.',
              community_issue_id: newFeed.id,
            },
          ],
        },
      }),
    })

    await service.app
      .get(MeetingBriefingsService)
      .onExperimentRunCompleted(run2)

    const linksAfterSecond =
      await service.prisma.meetingBriefingItemLink.findMany({
        where: { meetingBriefingId: briefing!.id },
      })

    expect(linksAfterSecond).toHaveLength(1)
    expect(linksAfterSecond[0]).toMatchObject({
      briefingItemId: 'item_002',
      communityIssueId: newFeed.id,
      priorityId: null,
    })
  })

  it(
    'produces no link for an item with neither priority_id nor' +
      ' community_issue_id',
    async () => {
      const suffix = Date.now()
      const orgSlug = `bil-nolink-${suffix}`
      const eo = await seedOrgAndElectedOffice(orgSlug)

      const artifactKey = `bil-nolink-${suffix}.json`
      const run = await seedBriefingRun(orgSlug, artifactKey, eo.id)

      mockS3({
        [artifactKey]: JSON.stringify({
          ...baseArtifact,
          executive_summary: {
            lead_in: 'One unstamped item.',
            items: [
              {
                item_id: 'item_001',
                overview: 'No link needed.',
              },
            ],
          },
        }),
      })

      await service.app
        .get(MeetingBriefingsService)
        .onExperimentRunCompleted(run)

      const briefing = await service.prisma.meetingBriefing.findUnique({
        where: {
          electedOfficeId_meetingDate: {
            electedOfficeId: eo.id,
            meetingDate: new Date('2026-07-15'),
          },
        },
      })
      expect(briefing).not.toBeNull()

      const links = await service.prisma.meetingBriefingItemLink.findMany({
        where: { meetingBriefingId: briefing!.id },
      })
      expect(links).toHaveLength(0)
    },
  )
})
