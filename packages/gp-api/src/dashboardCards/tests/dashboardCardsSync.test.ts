import { describe, expect, it, vi } from 'vitest'
import { ExperimentRunStatus, MeetingBriefing } from '../../generated/prisma'
import { useTestService } from '@/test-service'
import { DashboardCardsService } from '../services/dashboardCards.service'
import { MeetingBriefingsService } from '@/meetings/services/meetingBriefings.service'

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

type ArtifactItem = { item_id: string; title: string; overview: string }

const buildArtifact = (
  meetingDate: string,
  items: ArtifactItem[],
): PrismaJson.MeetingBriefingArtifact => ({
  briefing_status: 'briefing_ready',
  meeting_date: meetingDate,
  meeting_name: 'City Council',
  // The card sync reads executive_summary.items[] (the curated featured set).
  // executive_summary holds no headline/subheadline in the real artifact, so
  // summary falls back to lead_in.
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

const DATE = '2026-07-15'

describe('DashboardCardsService.syncFromBriefing', () => {
  it('creates one briefing card plus one card per exec-summary item', async () => {
    const orgSlug = 'eo-sync-create'
    const eo = await seedElectedOffice(orgSlug)
    const briefing = await seedBriefing(
      eo.id,
      orgSlug,
      DATE,
      buildArtifact(DATE, [
        { item_id: 'item_a', title: 'Rezoning', overview: 'Vote on rezoning' },
        { item_id: 'item_b', title: 'Budget', overview: 'Annual budget' },
      ]),
    )

    await sync().syncFromBriefing(briefing)

    const cards = await service.prisma.dashboardCard.findMany({
      where: { electedOfficeId: eo.id },
      orderBy: { sourceItemId: 'asc' },
    })
    expect(cards).toHaveLength(3)

    const briefingCard = cards.find((c) => c.type === 'briefing')
    expect(briefingCard).toMatchObject({
      sourceItemId: null,
      title: 'City Council',
      summary: 'The following items require action:',
      ctaLabel: 'Prepare for the meeting',
      ctaHref: `/dashboard/briefings/${DATE}`,
      sourceExternalId: briefing.id,
    })

    const itemCard = cards.find((c) => c.sourceItemId === 'item_a')
    expect(itemCard).toMatchObject({
      type: 'agenda_item',
      title: 'Rezoning',
      summary: 'Vote on rezoning',
      ctaLabel: 'Learn more',
      ctaHref: `/dashboard/briefings/${DATE}#briefing-item-item_a`,
    })
  })

  it('reconciles: adds new featured items and removes de-featured ones', async () => {
    const orgSlug = 'eo-sync-reconcile'
    const eo = await seedElectedOffice(orgSlug)
    const briefing = await seedBriefing(
      eo.id,
      orgSlug,
      DATE,
      buildArtifact(DATE, [
        { item_id: 'item_a', title: 'A', overview: 'a' },
        { item_id: 'item_b', title: 'B', overview: 'b' },
      ]),
    )

    await sync().syncFromBriefing(briefing)

    // Second run: item_b dropped, item_c added.
    const updated = await service.prisma.meetingBriefing.update({
      where: { id: briefing.id },
      data: {
        artifact: buildArtifact(DATE, [
          { item_id: 'item_a', title: 'A', overview: 'a' },
          { item_id: 'item_c', title: 'C', overview: 'c' },
        ]),
      },
    })
    await sync().syncFromBriefing(updated)

    const itemIds = (
      await service.prisma.dashboardCard.findMany({
        where: { electedOfficeId: eo.id, type: 'agenda_item' },
      })
    )
      .map((c) => c.sourceItemId)
      .sort()
    expect(itemIds).toEqual(['item_a', 'item_c'])
  })

  it('preserves dismissedAt across regeneration', async () => {
    const orgSlug = 'eo-sync-dismiss-preserve'
    const eo = await seedElectedOffice(orgSlug)
    const briefing = await seedBriefing(
      eo.id,
      orgSlug,
      DATE,
      buildArtifact(DATE, [{ item_id: 'item_a', title: 'A', overview: 'a' }]),
    )
    await sync().syncFromBriefing(briefing)

    const card = await service.prisma.dashboardCard.findFirstOrThrow({
      where: { electedOfficeId: eo.id, sourceItemId: 'item_a' },
    })
    await sync().dismiss(eo.id, card.id)

    // Re-run with the same item but changed content.
    const updated = await service.prisma.meetingBriefing.update({
      where: { id: briefing.id },
      data: {
        artifact: buildArtifact(DATE, [
          { item_id: 'item_a', title: 'A renamed', overview: 'a updated' },
        ]),
      },
    })
    await sync().syncFromBriefing(updated)

    const after = await service.prisma.dashboardCard.findUniqueOrThrow({
      where: { id: card.id },
    })
    expect(after.dismissedAt).not.toBeNull()
    expect(after.title).toBe('A renamed')
  })

  it('produces no cards from an artifact missing the card fields', async () => {
    const orgSlug = 'eo-sync-malformed'
    const eo = await seedElectedOffice(orgSlug)
    const briefing = await seedBriefing(
      eo.id,
      orgSlug,
      DATE,
      // No meeting_date -> safeParse fails -> zero cards, no throw.
      { briefing_status: 'briefing_ready' },
    )

    await expect(sync().syncFromBriefing(briefing)).resolves.toBeUndefined()
    const count = await service.prisma.dashboardCard.count({
      where: { electedOfficeId: eo.id },
    })
    expect(count).toBe(0)
  })

  it('preserves existing cards when a re-sync artifact no longer parses', async () => {
    const orgSlug = 'eo-sync-bad-resync'
    const eo = await seedElectedOffice(orgSlug)
    const briefing = await seedBriefing(
      eo.id,
      orgSlug,
      DATE,
      buildArtifact(DATE, [{ item_id: 'item_a', title: 'A', overview: 'a' }]),
    )
    await sync().syncFromBriefing(briefing)
    expect(
      await service.prisma.dashboardCard.count({
        where: { electedOfficeId: eo.id },
      }),
    ).toBe(2)

    // Re-run after the artifact regenerated into an unparseable shape: the sync
    // must leave the previously-synced cards intact rather than wipe the agenda
    // items while stranding the briefing card.
    const updated = await service.prisma.meetingBriefing.update({
      where: { id: briefing.id },
      data: { artifact: { briefing_status: 'briefing_ready' } },
    })
    await sync().syncFromBriefing(updated)

    const types = (
      await service.prisma.dashboardCard.findMany({
        where: { electedOfficeId: eo.id },
      })
    )
      .map((c) => c.type)
      .sort()
    expect(types).toEqual(['agenda_item', 'briefing'])
  })

  it('a card-sync failure does not block the briefing row write', async () => {
    const orgSlug = 'eo-hook-no-block'
    const eo = await seedElectedOffice(orgSlug)
    const meetings = service.app.get(MeetingBriefingsService)
    const cards = service.app.get(DashboardCardsService)

    vi.spyOn(cards, 'syncFromBriefing').mockRejectedValueOnce(new Error('boom'))

    // handleBriefingCompletion is private; the hook runs after the briefing
    // row write and must swallow sync failures. We drive it through the
    // briefing write + sync call directly to assert the row survives.
    const artifact = buildArtifact(DATE, [
      { item_id: 'item_a', title: 'A', overview: 'a' },
    ])
    const briefing = await seedBriefing(eo.id, orgSlug, DATE, artifact)

    const privateMeetings = meetings as unknown as {
      syncDashboardCardsForBriefing: (
        electedOfficeId: string,
        artifact: PrismaJson.MeetingBriefingArtifact,
      ) => Promise<void>
    }
    await expect(
      privateMeetings.syncDashboardCardsForBriefing(eo.id, artifact),
    ).resolves.toBeUndefined()

    const stillThere = await service.prisma.meetingBriefing.findUnique({
      where: { id: briefing.id },
    })
    expect(stillThere).not.toBeNull()
  })
})
