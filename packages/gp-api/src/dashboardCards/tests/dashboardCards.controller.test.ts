import { describe, expect, it } from 'vitest'
import { DashboardCardType } from '../../generated/prisma'
import { useTestService } from '@/test-service'
import { addDays, endOfDay, startOfWeek, subDays } from 'date-fns'

const service = useTestService()

const orgHeader = (slug: string) => ({
  headers: { 'x-organization-slug': slug },
})

let ownerSeq = 0
const seedElectedOffice = async (
  orgSlug: string,
  opts: { distinctOwner?: boolean } = {},
) => {
  let ownerId = service.user.id
  if (opts.distinctOwner) {
    ownerSeq += 1
    const owner = await service.prisma.user.create({
      data: {
        id: 9000 + ownerSeq,
        clerkId: `other_user_${ownerSeq}`,
        email: `other-${ownerSeq}@goodparty.org`,
        firstName: 'Other',
        lastName: 'Official',
      },
    })
    ownerId = owner.id
  }
  await service.prisma.organization.create({
    data: { slug: orgSlug, ownerId },
  })
  return service.prisma.electedOffice.create({
    data: { organizationSlug: orgSlug, userId: ownerId },
  })
}

let cardSeq = 0
const seedCard = async (
  electedOfficeId: string,
  overrides: {
    dueDate: Date
    dismissedAt?: Date | null
    type?: DashboardCardType
  },
) => {
  cardSeq += 1
  return service.prisma.dashboardCard.create({
    data: {
      electedOfficeId,
      type: overrides.type ?? DashboardCardType.agenda_item,
      title: `card ${cardSeq}`,
      summary: 'summary',
      ctaLabel: 'Learn more',
      ctaHref: '/dashboard/briefings/2026-07-15',
      dueDate: overrides.dueDate,
      sourceExternalId: `briefing-${cardSeq}`,
      sourceItemId: `item-${cardSeq}`,
      dismissedAt: overrides.dismissedAt ?? null,
    },
  })
}

describe('GET /v1/dashboard/cards', () => {
  it('active excludes dismissed and expired, ordered by due date asc', async () => {
    const orgSlug = 'eo-cards-active'
    const eo = await seedElectedOffice(orgSlug)
    const now = new Date()

    const soon = await seedCard(eo.id, { dueDate: addDays(now, 2) })
    const later = await seedCard(eo.id, { dueDate: addDays(now, 9) })
    await seedCard(eo.id, { dueDate: subDays(now, 1) }) // expired
    await seedCard(eo.id, {
      dueDate: addDays(now, 3),
      dismissedAt: now,
    }) // dismissed

    const res = await service.client.get(
      '/v1/dashboard/cards',
      orgHeader(orgSlug),
    )

    expect(res.status).toBe(200)
    expect(res.data.bucket).toBe('active')
    expect(res.data.cards.map((c: { id: string }) => c.id)).toEqual([
      soon.id,
      later.id,
    ])
  })

  it('active includes a card due later today', async () => {
    const orgSlug = 'eo-cards-today'
    const eo = await seedElectedOffice(orgSlug)
    const today = await seedCard(eo.id, { dueDate: endOfDay(new Date()) })

    const res = await service.client.get(
      '/v1/dashboard/cards',
      orgHeader(orgSlug),
    )
    expect(res.data.cards.map((c: { id: string }) => c.id)).toContain(today.id)
  })

  it('defaults to the active bucket when none is given', async () => {
    const orgSlug = 'eo-cards-default'
    const eo = await seedElectedOffice(orgSlug)
    await seedCard(eo.id, { dueDate: addDays(new Date(), 1) })

    const res = await service.client.get(
      '/v1/dashboard/cards',
      orgHeader(orgSlug),
    )
    expect(res.data.bucket).toBe('active')
    expect(res.data.cards).toHaveLength(1)
  })

  it('skipped returns dismissed cards (retained, not deleted)', async () => {
    const orgSlug = 'eo-cards-skipped'
    const eo = await seedElectedOffice(orgSlug)
    const now = new Date()
    const dismissed = await seedCard(eo.id, {
      dueDate: addDays(now, 5),
      dismissedAt: now,
    })
    await seedCard(eo.id, { dueDate: addDays(now, 5) })

    const res = await service.client.get(
      '/v1/dashboard/cards?bucket=skipped',
      orgHeader(orgSlug),
    )
    expect(res.data.cards.map((c: { id: string }) => c.id)).toEqual([
      dismissed.id,
    ])
  })

  it('missed returns expired, non-dismissed cards', async () => {
    const orgSlug = 'eo-cards-missed'
    const eo = await seedElectedOffice(orgSlug)
    const now = new Date()
    const missed = await seedCard(eo.id, { dueDate: subDays(now, 2) })
    await seedCard(eo.id, { dueDate: subDays(now, 2), dismissedAt: now }) // dismissed
    await seedCard(eo.id, { dueDate: addDays(now, 2) }) // future

    const res = await service.client.get(
      '/v1/dashboard/cards?bucket=missed',
      orgHeader(orgSlug),
    )
    expect(res.data.cards.map((c: { id: string }) => c.id)).toEqual([missed.id])
  })

  it('this_week returns the current-week set regardless of state', async () => {
    const orgSlug = 'eo-cards-this-week'
    const eo = await seedElectedOffice(orgSlug)
    const now = new Date()
    const midWeek = addDays(startOfWeek(now), 3)
    const inWeek = await seedCard(eo.id, { dueDate: midWeek })
    const inWeekDismissed = await seedCard(eo.id, {
      dueDate: midWeek,
      dismissedAt: now,
    })
    await seedCard(eo.id, { dueDate: addDays(now, 30) }) // outside week

    const res = await service.client.get(
      '/v1/dashboard/cards?bucket=this_week',
      orgHeader(orgSlug),
    )
    const ids = res.data.cards.map((c: { id: string }) => c.id).sort()
    expect(ids).toEqual([inWeek.id, inWeekDismissed.id].sort())
  })

  it('is scoped to the requesting office', async () => {
    const orgSlug = 'eo-cards-scope-a'
    const otherSlug = 'eo-cards-scope-b'
    const eo = await seedElectedOffice(orgSlug)
    const other = await seedElectedOffice(otherSlug, { distinctOwner: true })
    await seedCard(eo.id, { dueDate: addDays(new Date(), 1) })
    await seedCard(other.id, { dueDate: addDays(new Date(), 1) })

    const res = await service.client.get(
      '/v1/dashboard/cards',
      orgHeader(orgSlug),
    )
    expect(res.data.cards).toHaveLength(1)
  })
})

describe('PUT /v1/dashboard/cards/:id/dismiss', () => {
  it('sets dismissedAt and returns 204', async () => {
    const orgSlug = 'eo-dismiss'
    const eo = await seedElectedOffice(orgSlug)
    const card = await seedCard(eo.id, { dueDate: addDays(new Date(), 3) })

    const res = await service.client.put(
      `/v1/dashboard/cards/${card.id}/dismiss`,
      undefined,
      orgHeader(orgSlug),
    )
    expect(res.status).toBe(204)

    const after = await service.prisma.dashboardCard.findUniqueOrThrow({
      where: { id: card.id },
    })
    expect(after.dismissedAt).not.toBeNull()
  })

  it('does not dismiss a card belonging to another office', async () => {
    const orgSlug = 'eo-dismiss-scope-a'
    const otherSlug = 'eo-dismiss-scope-b'
    await seedElectedOffice(orgSlug)
    const other = await seedElectedOffice(otherSlug, { distinctOwner: true })
    const card = await seedCard(other.id, { dueDate: addDays(new Date(), 3) })

    const res = await service.client.put(
      `/v1/dashboard/cards/${card.id}/dismiss`,
      undefined,
      orgHeader(orgSlug),
    )
    expect(res.status).toBe(204)

    const after = await service.prisma.dashboardCard.findUniqueOrThrow({
      where: { id: card.id },
    })
    expect(after.dismissedAt).toBeNull()
  })
})
