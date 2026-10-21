import { describe, expect, it, vi } from 'vitest'
import {
  BUILD_CITIZENS_PANEL_MESSAGE,
  type DashboardCardsResponse,
} from '@goodparty_org/contracts'
import { ChatScope, PrioritySource } from '../../generated/prisma'
import { useTestService } from '@/test-service'
import { FeaturesService } from '@/features/services/features.service'

const service = useTestService()

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

const seedPriority = (electedOfficeId: string, source: PrioritySource) =>
  service.prisma.priority.create({
    data: { electedOfficeId, title: 'Housing', description: 'desc', source },
  })

const seedConversation = (organizationSlug: string, firstTurn: string) =>
  service.prisma.chatConversation.create({
    data: {
      ownerUserId: service.user.id,
      organizationSlug,
      scope: ChatScope.chief_of_staff,
      messages: { create: { role: 'user', content: firstTurn } },
    },
  })

const completeCard = (orgSlug: string, key: string) =>
  service.client.put(
    `/v1/dashboard/onboarding-cards/${key}/complete`,
    undefined,
    orgHeader(orgSlug),
  )

type Card = { key: string; status: string }
const statusOf = (cards: Card[], key: string) =>
  cards.find((c) => c.key === key)?.status

describe('GET /v1/dashboard/onboarding-cards', () => {
  it('returns both cards active for a fresh office', async () => {
    const orgSlug = 'eo-onboarding-fresh'
    await seedElectedOffice(orgSlug)

    const res = await service.client.get(
      '/v1/dashboard/onboarding-cards',
      orgHeader(orgSlug),
    )

    expect(res.status).toBe(200)
    expect(statusOf(res.data.cards, 'meet')).toBe('active')
    expect(statusOf(res.data.cards, 'priorities')).toBe('active')
  })

  it('marks priorities completed once a user-stated priority exists', async () => {
    const orgSlug = 'eo-onboarding-priorities'
    const eo = await seedElectedOffice(orgSlug)
    await seedPriority(eo.id, PrioritySource.user_stated)

    const res = await service.client.get(
      '/v1/dashboard/onboarding-cards',
      orgHeader(orgSlug),
    )
    expect(statusOf(res.data.cards, 'priorities')).toBe('completed')
  })

  it('win-imported and archived priorities do not complete the card', async () => {
    const orgSlug = 'eo-onboarding-priorities-win'
    const eo = await seedElectedOffice(orgSlug)
    await seedPriority(eo.id, PrioritySource.win_import)
    await service.prisma.priority.create({
      data: {
        electedOfficeId: eo.id,
        title: 'old',
        description: 'd',
        source: PrioritySource.user_stated,
        archivedAt: new Date(),
      },
    })

    const res = await service.client.get(
      '/v1/dashboard/onboarding-cards',
      orgHeader(orgSlug),
    )
    expect(statusOf(res.data.cards, 'priorities')).toBe('active')
  })

  it('keeps meet active through Chief of Staff conversations it did not start', async () => {
    const orgSlug = 'eo-onboarding-meet-other-chats'
    await seedElectedOffice(orgSlug)
    await seedConversation(orgSlug, BUILD_CITIZENS_PANEL_MESSAGE)
    await seedConversation(orgSlug, 'What is on the agenda this week?')

    const res = await service.client.get(
      '/v1/dashboard/onboarding-cards',
      orgHeader(orgSlug),
    )
    expect(statusOf(res.data.cards, 'meet')).toBe('active')
  })

  it('shows a just-onboarded office meet, with the build card behind it', async () => {
    const orgSlug = 'eo-onboarding-just-onboarded'
    vi.spyOn(
      service.app.get(FeaturesService),
      'isFeatureEnabled',
    ).mockResolvedValue(true)
    const eo = await seedElectedOffice(orgSlug)
    await seedPriority(eo.id, PrioritySource.user_stated)
    await seedConversation(orgSlug, BUILD_CITIZENS_PANEL_MESSAGE)

    const onboarding = await service.client.get(
      '/v1/dashboard/onboarding-cards',
      orgHeader(orgSlug),
    )
    expect(statusOf(onboarding.data.cards, 'meet')).toBe('active')
    expect(statusOf(onboarding.data.cards, 'priorities')).toBe('completed')

    const cards = await service.client.get<DashboardCardsResponse>(
      '/v1/dashboard/cards?bucket=active',
      orgHeader(orgSlug),
    )
    expect(cards.data.cards.map((card) => card.ctaLabel)).toContain(
      'Build your panel',
    )
  })
})

describe('PUT /v1/dashboard/onboarding-cards/:key/complete', () => {
  it('completes meet once its button opens the intro, returning 204', async () => {
    const orgSlug = 'eo-onboarding-meet-opened'
    await seedElectedOffice(orgSlug)

    const res = await completeCard(orgSlug, 'meet')
    expect(res.status).toBe(204)
    expect((await completeCard(orgSlug, 'meet')).status).toBe(204)

    const after = await service.client.get(
      '/v1/dashboard/onboarding-cards',
      orgHeader(orgSlug),
    )
    expect(statusOf(after.data.cards, 'meet')).toBe('completed')
    expect(statusOf(after.data.cards, 'priorities')).toBe('active')
  })

  it('rejects an unknown card key', async () => {
    const orgSlug = 'eo-onboarding-complete-bad-key'
    await seedElectedOffice(orgSlug)

    expect((await completeCard(orgSlug, 'nonsense')).status).toBe(400)
  })
})

describe('PUT /v1/dashboard/onboarding-cards/:key/skip', () => {
  it('marks a card skipped and persists, returning 204', async () => {
    const orgSlug = 'eo-onboarding-skip'
    await seedElectedOffice(orgSlug)

    const res = await service.client.put(
      '/v1/dashboard/onboarding-cards/meet/skip',
      undefined,
      orgHeader(orgSlug),
    )
    expect(res.status).toBe(204)

    const after = await service.client.get(
      '/v1/dashboard/onboarding-cards',
      orgHeader(orgSlug),
    )
    expect(statusOf(after.data.cards, 'meet')).toBe('skipped')
  })

  it('skipping twice is idempotent', async () => {
    const orgSlug = 'eo-onboarding-skip-twice'
    await seedElectedOffice(orgSlug)

    await service.client.put(
      '/v1/dashboard/onboarding-cards/priorities/skip',
      undefined,
      orgHeader(orgSlug),
    )
    const res = await service.client.put(
      '/v1/dashboard/onboarding-cards/priorities/skip',
      undefined,
      orgHeader(orgSlug),
    )
    expect(res.status).toBe(204)
  })

  it('completion beats a prior skip', async () => {
    const orgSlug = 'eo-onboarding-skip-then-complete'
    await seedElectedOffice(orgSlug)
    await service.client.put(
      '/v1/dashboard/onboarding-cards/meet/skip',
      undefined,
      orgHeader(orgSlug),
    )
    await completeCard(orgSlug, 'meet')

    const res = await service.client.get(
      '/v1/dashboard/onboarding-cards',
      orgHeader(orgSlug),
    )
    expect(statusOf(res.data.cards, 'meet')).toBe('completed')
  })

  it('rejects an unknown card key', async () => {
    const orgSlug = 'eo-onboarding-bad-key'
    await seedElectedOffice(orgSlug)

    const res = await service.client.put(
      '/v1/dashboard/onboarding-cards/nonsense/skip',
      undefined,
      orgHeader(orgSlug),
    )
    expect(res.status).toBe(400)
  })
})
