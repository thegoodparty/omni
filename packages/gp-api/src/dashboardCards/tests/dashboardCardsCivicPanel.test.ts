import { beforeEach, describe, expect, it, vi } from 'vitest'
import { addDays, subDays } from 'date-fns'
import {
  DashboardCardType,
  OutreachStatus,
  OutreachType,
  PrioritySource,
} from '../../generated/prisma'
import { useTestService } from '@/test-service'
import { FeaturesService } from '@/features/services/features.service'
import type { DashboardCardsResponse } from '@goodparty_org/contracts'

const service = useTestService()

const isFeatureEnabled = vi.fn()

beforeEach(() => {
  isFeatureEnabled.mockReset().mockResolvedValue(true)
  vi.spyOn(
    service.app.get(FeaturesService),
    'isFeatureEnabled',
  ).mockImplementation(isFeatureEnabled)
})

const seedElectedOffice = async (orgSlug: string) => {
  await service.prisma.organization.create({
    data: { slug: orgSlug, ownerId: service.user.id },
  })
  return service.prisma.electedOffice.create({
    data: { organizationSlug: orgSlug, userId: service.user.id },
  })
}

const seedPriority = (electedOfficeId: string, title: string) =>
  service.prisma.priority.create({
    data: {
      electedOfficeId,
      title,
      description: `${title}, described.`,
      source: PrioritySource.user_stated,
    },
  })

const seedText = (
  organizationSlug: string,
  status: OutreachStatus,
  asksToJoinCivicPanel = true,
) =>
  service.prisma.outreach.create({
    data: {
      organizationSlug,
      campaignId: null,
      outreachType: OutreachType.text,
      status,
      asksToJoinCivicPanel,
      message: 'Hi, this is Alex.',
    },
  })

const listCards = async (orgSlug: string, bucket = 'active') => {
  const res = await service.client.get<DashboardCardsResponse>(
    `/v1/dashboard/cards?bucket=${bucket}`,
    { headers: { 'x-organization-slug': orgSlug } },
  )
  expect(res.status).toBe(200)
  return res.data.cards
}

const panelRows = (electedOfficeId: string) =>
  service.prisma.dashboardCard.findMany({
    where: { electedOfficeId, type: DashboardCardType.civic_panel },
    orderBy: { title: 'asc' },
  })

const buildCard = {
  type: 'civic_panel',
  title: "Build your citizens' panel",
  ctaLabel: 'Get started',
  ctaHref:
    '/dashboard/constituent-outreach?compose=text&purpose=build_citizens_panel',
}

describe("GET /v1/dashboard/cards: the citizens' panel build card", () => {
  it('starts an office on one build card, ahead of its priorities', async () => {
    const eo = await seedElectedOffice('eo-civic-build-first')
    await seedPriority(eo.id, 'Affordable housing')

    const cards = await listCards('eo-civic-build-first')

    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({
      ...buildCard,
      sourceExternalId: `build:${eo.id}`,
      completedAt: null,
    })
    expect(cards[0]?.summary).toBe(
      'A paid text to up to 3,334 residents, about $117, so you hear from more than the loudest voices.',
    )
    expect(cards[0]?.summary.split(' ').length).toBeLessThanOrEqual(20)
  })

  it('makes no second build card on a repeat read', async () => {
    const eo = await seedElectedOffice('eo-civic-build-idempotent')

    await Promise.all([
      listCards('eo-civic-build-idempotent'),
      listCards('eo-civic-build-idempotent', 'this_week'),
    ])
    await listCards('eo-civic-build-idempotent')

    expect(await panelRows(eo.id)).toHaveLength(1)
  })

  it('stays open while the panel text is unpaid, or never asked to join', async () => {
    const eo = await seedElectedOffice('eo-civic-build-unpaid')
    await seedPriority(eo.id, 'Affordable housing')
    await seedText('eo-civic-build-unpaid', OutreachStatus.pending_payment)
    await seedText('eo-civic-build-unpaid', OutreachStatus.pending, false)

    const cards = await listCards('eo-civic-build-unpaid')

    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({ ...buildCard, completedAt: null })
  })

  it('is done once a text asking to join is paid, and the priority cards follow', async () => {
    const eo = await seedElectedOffice('eo-civic-build-sent')
    const housing = await seedPriority(eo.id, 'Affordable housing')
    await listCards('eo-civic-build-sent')
    await seedText('eo-civic-build-sent', OutreachStatus.pending)

    const active = await listCards('eo-civic-build-sent')
    const done = await listCards('eo-civic-build-sent', 'done')

    expect(active).toHaveLength(1)
    expect(active[0]).toMatchObject({
      type: 'civic_panel',
      title: 'Affordable housing',
      summary: 'Start by naming the problem in one sentence.',
      ctaLabel: 'Open priority',
      ctaHref: `/dashboard/priorities/${housing.id}`,
      sourceExternalId: housing.id,
    })
    expect(done).toHaveLength(1)
    expect(done[0]).toMatchObject(buildCard)
  })

  it('counts a skipped build card as done once the text goes out', async () => {
    const eo = await seedElectedOffice('eo-civic-build-skipped')
    await listCards('eo-civic-build-skipped')
    const [card] = await panelRows(eo.id)
    if (!card) throw new Error('no card')
    await service.prisma.dashboardCard.update({
      where: { id: card.id },
      data: { dismissedAt: new Date() },
    })
    await seedText('eo-civic-build-skipped', OutreachStatus.completed)

    await listCards('eo-civic-build-skipped')

    const [after] = await panelRows(eo.id)
    expect(after?.completedAt).not.toBeNull()
    expect(after?.dismissedAt).toBeNull()
  })

  it('keeps an open build card from lapsing into missed', async () => {
    const eo = await seedElectedOffice('eo-civic-build-lapsed')
    await listCards('eo-civic-build-lapsed')
    const [card] = await panelRows(eo.id)
    if (!card) throw new Error('no card')
    await service.prisma.dashboardCard.update({
      where: { id: card.id },
      data: { dueDate: subDays(new Date(), 1) },
    })

    const cards = await listCards('eo-civic-build-lapsed')

    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject(buildCard)
  })
})

describe('GET /v1/dashboard/cards: a card per priority, once the panel is built', () => {
  const builtOffice = async (orgSlug: string) => {
    const eo = await seedElectedOffice(orgSlug)
    await seedText(orgSlug, OutreachStatus.pending)
    return eo
  }

  const priorityRows = async (electedOfficeId: string) =>
    (await panelRows(electedOfficeId)).filter(
      (card) => !card.sourceExternalId.startsWith('build:'),
    )

  it('makes one card per open priority, and no duplicate on a repeat read', async () => {
    const eo = await builtOffice('eo-civic-card-create')
    await seedPriority(eo.id, 'Affordable housing')
    await seedPriority(eo.id, 'Road safety')

    await listCards('eo-civic-card-create')
    await listCards('eo-civic-card-create')

    expect((await priorityRows(eo.id)).map((card) => card.title)).toEqual([
      'Affordable housing',
      'Road safety',
    ])
  })

  it('keeps a skipped card skipped', async () => {
    const eo = await builtOffice('eo-civic-card-skipped')
    await seedPriority(eo.id, 'Affordable housing')
    await listCards('eo-civic-card-skipped')
    const [card] = await priorityRows(eo.id)
    if (!card) throw new Error('no card')
    await service.client.put(`/v1/dashboard/cards/${card.id}/dismiss`, null, {
      headers: { 'x-organization-slug': 'eo-civic-card-skipped' },
    })

    expect(await listCards('eo-civic-card-skipped')).toHaveLength(0)
    const cards = await priorityRows(eo.id)
    expect(cards).toHaveLength(1)
    expect(cards[0]?.dismissedAt).not.toBeNull()
  })

  it('follows a renamed priority', async () => {
    const eo = await builtOffice('eo-civic-card-renamed')
    const housing = await seedPriority(eo.id, 'Affordable housing')
    await listCards('eo-civic-card-renamed')

    await service.prisma.priority.update({
      where: { id: housing.id },
      data: { title: 'Housing costs' },
    })
    await listCards('eo-civic-card-renamed')

    const [card] = await priorityRows(eo.id)
    expect(card?.title).toBe('Housing costs')
  })

  it("reads the priority's next step, and follows it as it moves", async () => {
    const eo = await builtOffice('eo-civic-card-next-step')
    const housing = await seedPriority(eo.id, 'Affordable housing')
    await service.prisma.priority.update({
      where: { id: housing.id },
      data: {
        status: { version: 1, steps: [] },
        nextAction: 'Ask the planning director for the permit data.',
      },
    })

    const [first] = await listCards('eo-civic-card-next-step')
    expect(first).toMatchObject({
      title: 'Affordable housing',
      summary: 'Ask the planning director for the permit data.',
      ctaLabel: 'Open priority',
      ctaHref: `/dashboard/priorities/${housing.id}`,
    })

    await service.prisma.priority.update({
      where: { id: housing.id },
      data: { nextAction: 'Draft two options for the council.' },
    })
    const [moved] = await listCards('eo-civic-card-next-step')
    expect(moved?.summary).toBe('Draft two options for the council.')

    await service.prisma.priority.update({
      where: { id: housing.id },
      data: { nextAction: null },
    })
    const [worked] = await listCards('eo-civic-card-next-step')
    expect(worked?.summary).toBe('Pick up where you left off.')
  })

  it('drops an untouched card once its priority is archived', async () => {
    const eo = await builtOffice('eo-civic-card-archived')
    const housing = await seedPriority(eo.id, 'Affordable housing')
    await listCards('eo-civic-card-archived')

    await service.prisma.priority.update({
      where: { id: housing.id },
      data: { archivedAt: new Date() },
    })
    await listCards('eo-civic-card-archived')

    expect(await priorityRows(eo.id)).toHaveLength(0)
    expect(await panelRows(eo.id)).toHaveLength(1)
  })
})

const act = async (
  orgSlug: string,
  id: string,
  action: 'complete' | 'dismiss' | 'snooze' | 'restore',
) => {
  const res = await service.client.put(
    `/v1/dashboard/cards/${id}/${action}`,
    null,
    { headers: { 'x-organization-slug': orgSlug } },
  )
  expect(res.status).toBe(204)
}

const seedOtherCards = (electedOfficeId: string) =>
  service.prisma.dashboardCard.createMany({
    data: [
      {
        electedOfficeId,
        type: DashboardCardType.briefing,
        sourceExternalId: 'briefing-1',
        title: 'City council meeting',
        summary: 'Three items worth reading first.',
        ctaLabel: 'Prepare for the meeting',
        ctaHref: '/dashboard/briefings/2026-10-20',
        dueDate: addDays(new Date(), 5),
      },
      {
        electedOfficeId,
        type: DashboardCardType.agenda_item,
        sourceExternalId: 'briefing-1',
        sourceItemId: 'item-1',
        title: 'Rezoning on Main Street',
        summary: 'A vote on the corner lot.',
        ctaLabel: 'Learn more',
        ctaHref: '/dashboard/briefings/2026-10-20/items/item-1',
        dueDate: addDays(new Date(), 5),
      },
      {
        electedOfficeId,
        type: DashboardCardType.community_issue,
        sourceExternalId: 'issue-1',
        title: 'Potholes on Elm',
        summary: 'Residents keep raising it.',
        ctaLabel: 'View issue',
        ctaHref: '/dashboard/community-issues/issue-1',
        dueDate: addDays(new Date(), 7),
      },
    ],
  })

const OTHER_TITLES = [
  'City council meeting',
  'Potholes on Elm',
  'Rezoning on Main Street',
]

const titles = (cards: { title: string }[]) =>
  cards.map((card) => card.title).sort()

describe("The citizens' panel build card, then the usual cards", () => {
  const officeWithBuildCard = async (orgSlug: string) => {
    const eo = await seedElectedOffice(orgSlug)
    await seedPriority(eo.id, 'Affordable housing')
    await seedOtherCards(eo.id)
    const cards = await listCards(orgSlug)
    const build = cards.find((card) => card.title === buildCard.title)
    if (!build) throw new Error('no build card')
    return { eo, cards, build }
  }

  it('gives an office that onboarded long ago the build card on its next visit, beside its other cards', async () => {
    const orgSlug = 'eo-civic-seq-existing'
    await service.prisma.organization.create({
      data: { slug: orgSlug, ownerId: service.user.id },
    })
    const eo = await service.prisma.electedOffice.create({
      data: {
        organizationSlug: orgSlug,
        userId: service.user.id,
        createdAt: subDays(new Date(), 400),
      },
    })
    await seedPriority(eo.id, 'Affordable housing')
    await seedOtherCards(eo.id)
    expect(await panelRows(eo.id)).toHaveLength(0)

    const before = await listCards(orgSlug)
    expect(titles(before)).toEqual([buildCard.title, ...OTHER_TITLES].sort())

    const build = before.find((card) => card.title === buildCard.title)
    if (!build) throw new Error('no build card')
    await act(orgSlug, build.id, 'complete')

    const after = await listCards(orgSlug)
    expect(titles(after)).toEqual(
      ['Affordable housing', ...OTHER_TITLES].sort(),
    )
    expect(
      after.find((card) => card.title === 'Affordable housing'),
    ).toMatchObject({
      type: 'civic_panel',
      summary: 'Start by naming the problem in one sentence.',
    })
    expect(titles(await listCards(orgSlug, 'done'))).toEqual([buildCard.title])
  })

  it('shows the priority cards while the build card is set aside, and hides them again once it is brought back', async () => {
    const orgSlug = 'eo-civic-seq-not-for-me'
    const { build } = await officeWithBuildCard(orgSlug)

    await act(orgSlug, build.id, 'dismiss')
    expect(titles(await listCards(orgSlug))).toEqual(
      ['Affordable housing', ...OTHER_TITLES].sort(),
    )
    expect(titles(await listCards(orgSlug, 'skipped'))).toEqual([
      buildCard.title,
    ])

    await act(orgSlug, build.id, 'restore')
    expect(titles(await listCards(orgSlug))).toEqual(
      [buildCard.title, ...OTHER_TITLES].sort(),
    )
    expect(await listCards(orgSlug, 'skipped')).toHaveLength(0)
  })

  it('puts the build card off for 3 days, then brings it back to the front', async () => {
    const orgSlug = 'eo-civic-seq-snooze'
    const { eo, build } = await officeWithBuildCard(orgSlug)

    await act(orgSlug, build.id, 'snooze')
    expect(titles(await listCards(orgSlug))).toEqual(
      ['Affordable housing', ...OTHER_TITLES].sort(),
    )
    const [snoozed] = (await panelRows(eo.id)).filter(
      (card) => card.id === build.id,
    )
    expect(snoozed?.snoozedUntil?.getTime()).toBeGreaterThan(
      addDays(new Date(), 2).getTime(),
    )
    expect(snoozed?.dismissedAt).toBeNull()

    await service.prisma.dashboardCard.update({
      where: { id: build.id },
      data: { snoozedUntil: subDays(new Date(), 1) },
    })
    expect(titles(await listCards(orgSlug))).toEqual(
      [buildCard.title, ...OTHER_TITLES].sort(),
    )
  })

  it('is still done by the panel text after it was put off', async () => {
    const orgSlug = 'eo-civic-seq-snooze-sent'
    const { eo, build } = await officeWithBuildCard(orgSlug)
    await act(orgSlug, build.id, 'snooze')
    await seedText(orgSlug, OutreachStatus.pending)

    await listCards(orgSlug)

    const row = (await panelRows(eo.id)).find((card) => card.id === build.id)
    expect(row?.completedAt).not.toBeNull()
    expect(row?.snoozedUntil).toBeNull()
  })

  it('keeps every other card on the home page while the build card leads', async () => {
    const { cards } = await officeWithBuildCard('eo-civic-seq-others')
    expect(titles(cards)).toEqual([buildCard.title, ...OTHER_TITLES].sort())
  })
})

describe('GET /v1/dashboard/cards with serve-citizen-panels off', () => {
  it('lists the usual cards exactly as before', async () => {
    isFeatureEnabled.mockResolvedValue(false)
    const eo = await seedElectedOffice('eo-civic-flag-off-usual')
    await seedPriority(eo.id, 'Affordable housing')
    await seedOtherCards(eo.id)

    expect(titles(await listCards('eo-civic-flag-off-usual'))).toEqual(
      OTHER_TITLES,
    )
    expect(await panelRows(eo.id)).toHaveLength(0)
  })

  it('makes no panel card and lists none it already has', async () => {
    const eo = await seedElectedOffice('eo-civic-flag-off')
    await seedPriority(eo.id, 'Affordable housing')
    await listCards('eo-civic-flag-off')
    expect(await panelRows(eo.id)).toHaveLength(1)

    isFeatureEnabled.mockResolvedValue(false)
    const other = await seedElectedOffice('eo-civic-flag-off-fresh')
    await seedText('eo-civic-flag-off-fresh', OutreachStatus.pending)
    await seedPriority(other.id, 'Road safety')

    expect(await listCards('eo-civic-flag-off')).toHaveLength(0)
    expect(await listCards('eo-civic-flag-off', 'this_week')).toHaveLength(0)
    expect(await listCards('eo-civic-flag-off-fresh')).toHaveLength(0)
    expect(await panelRows(other.id)).toHaveLength(0)
    expect(isFeatureEnabled).toHaveBeenCalledWith({
      user: expect.objectContaining({ id: service.user.id }),
      feature: 'serve-citizen-panels',
    })
  })
})
