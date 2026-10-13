import { beforeEach, describe, expect, it, vi } from 'vitest'
import { subDays } from 'date-fns'
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
      summary:
        "Hear what your citizens' panel thinks about Affordable housing before you decide.",
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
    expect(card?.summary).toContain('thinks about Housing costs')
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

describe('GET /v1/dashboard/cards with serve-citizen-panels off', () => {
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
