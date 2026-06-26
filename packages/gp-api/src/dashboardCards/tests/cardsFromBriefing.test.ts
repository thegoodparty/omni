import { describe, expect, it } from 'vitest'
import { addDays, format } from 'date-fns'
import {
  DashboardCardType,
  ExperimentRunStatus,
  MeetingBriefing,
} from '../../generated/prisma'
import { useTestService } from '@/test-service'
import { DashboardCardsService } from '../services/dashboardCards.service'

// Bridges the two halves the other tests cover in isolation: card generation
// (dashboardCardsSync.test.ts asserts via Prisma) and the read API
// (dashboardCards.controller.test.ts seeds rows via Prisma). Here a real
// briefing artifact is synced, then read back over HTTP, so a generated card
// whose shape fails the read DTO would be caught.
const service = useTestService()

const sync = () => service.app.get(DashboardCardsService)

const orgHeader = (slug: string) => ({
  headers: { 'x-organization-slug': slug },
})

const seedElectedOffice = async (orgSlug: string) => {
  await service.prisma.organization.create({
    data: { slug: orgSlug, ownerId: service.user.id },
  })
  return service.prisma.electedOffice.create({
    data: { organizationSlug: orgSlug, userId: service.user.id },
  })
}

type ArtifactItem = { item_id: string; title: string; overview: string }

const buildArtifact = (
  meetingDate: string,
  items: ArtifactItem[],
): PrismaJson.MeetingBriefingArtifact => ({
  briefing_status: 'briefing_ready',
  meeting_date: meetingDate,
  meeting_name: 'City Council',
  executive_summary: {
    lead_in: 'The following items require action:',
    items,
  } as PrismaJson.MeetingBriefingArtifact['executive_summary'],
})

const seedBriefing = async (
  eoId: string,
  orgSlug: string,
  meetingDate: string,
  artifact: PrismaJson.MeetingBriefingArtifact,
): Promise<MeetingBriefing> => {
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
      artifact,
    },
  })
}

type CardDto = {
  id: string
  type: DashboardCardType
  title: string
  ctaHref: string
  sourceItemId: string | null
}

const cardsIn = async (
  orgSlug: string,
  bucket?: string,
): Promise<CardDto[]> => {
  const path = bucket
    ? `/v1/dashboard/cards?bucket=${bucket}`
    : '/v1/dashboard/cards'
  const res = await service.client.get(path, orgHeader(orgSlug))
  expect(res.status).toBe(200)
  return res.data.cards
}

describe('dashboard cards: generation -> read API', () => {
  // A future meeting date keeps the generated cards in the active bucket
  // (dueDate >= now), independent of when the suite runs.
  const meetingDate = format(addDays(new Date(), 14), 'yyyy-MM-dd')

  it('serves synced briefing cards over the active bucket', async () => {
    const orgSlug = 'eo-bridge-active'
    const eo = await seedElectedOffice(orgSlug)
    const briefing = await seedBriefing(
      eo.id,
      orgSlug,
      meetingDate,
      buildArtifact(meetingDate, [
        { item_id: 'item_a', title: 'Rezoning', overview: 'Vote on rezoning' },
        { item_id: 'item_b', title: 'Budget', overview: 'Annual budget' },
      ]),
    )

    await sync().syncFromBriefing(briefing)

    const active = await cardsIn(orgSlug)
    expect(active).toHaveLength(3)

    const briefingCard = active.find(
      (c) => c.type === DashboardCardType.briefing,
    )
    expect(briefingCard).toMatchObject({
      title: 'City Council',
      ctaHref: `/dashboard/briefings/${meetingDate}`,
      sourceItemId: null,
    })

    const itemCard = active.find((c) => c.sourceItemId === 'item_a')
    expect(itemCard).toMatchObject({
      type: DashboardCardType.agenda_item,
      title: 'Rezoning',
      ctaHref: `/dashboard/briefings/${meetingDate}#briefing-item-item_a`,
    })
  })

  it('moves a dismissed generated card from active to skipped', async () => {
    const orgSlug = 'eo-bridge-dismiss'
    const eo = await seedElectedOffice(orgSlug)
    const briefing = await seedBriefing(
      eo.id,
      orgSlug,
      meetingDate,
      buildArtifact(meetingDate, [
        { item_id: 'item_a', title: 'Rezoning', overview: 'Vote on rezoning' },
      ]),
    )
    await sync().syncFromBriefing(briefing)

    const active = await cardsIn(orgSlug)
    const target = active.find((c) => c.sourceItemId === 'item_a')
    expect(target).toBeDefined()

    const dismissRes = await service.client.put(
      `/v1/dashboard/cards/${target!.id}/dismiss`,
      undefined,
      orgHeader(orgSlug),
    )
    expect(dismissRes.status).toBe(204)

    const activeAfter = await cardsIn(orgSlug)
    expect(activeAfter.map((c) => c.id)).not.toContain(target!.id)

    const skipped = await cardsIn(orgSlug, 'skipped')
    expect(skipped.map((c) => c.id)).toContain(target!.id)
  })
})
