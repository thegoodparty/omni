import { describe, expect, it } from 'vitest'
import { ChatScope, PrioritySource } from '../../generated/prisma'
import { useTestService } from '@/test-service'

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

const seedConversation = (organizationSlug: string) =>
  service.prisma.chatConversation.create({
    data: {
      ownerUserId: service.user.id,
      organizationSlug,
      scope: ChatScope.chief_of_staff,
    },
  })

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

  it('marks meet completed once a chief-of-staff conversation exists', async () => {
    const orgSlug = 'eo-onboarding-meet'
    await seedElectedOffice(orgSlug)
    await seedConversation(orgSlug)

    const res = await service.client.get(
      '/v1/dashboard/onboarding-cards',
      orgHeader(orgSlug),
    )
    expect(statusOf(res.data.cards, 'meet')).toBe('completed')
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
    await seedConversation(orgSlug)

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
