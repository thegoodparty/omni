import { UnauthorizedException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import { ElectedOfficeController } from '../electedOffice/electedOffice.controller'
import { useTestService } from '../test-service'
import { MagicLinkService } from './magicLink.service'

const service = useTestService()

const inAWeek = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

describe('MagicLinkService', () => {
  it('recordSent keeps one row per user and preserves progress on resend', async () => {
    const svc = service.app.get(MagicLinkService)
    const userId = service.user.id

    const first = await svc.recordSent({
      userId,
      email: service.user.email,
      url: 'https://app/serve/welcome?__clerk_ticket=tok1',
      expiresAt: inAWeek(),
    })
    expect(first.url).toContain('tok1')

    // The lead redeems, then sales resends a fresh link.
    await svc.markRedeemed(userId)
    const second = await svc.recordSent({
      userId,
      email: service.user.email,
      url: 'https://app/serve/welcome?__clerk_ticket=tok2',
      expiresAt: inAWeek(),
    })

    expect(second.url).toContain('tok2')
    // Resend overwrites the URL but never resets captured progress.
    expect(second.redeemedAt).not.toBeNull()

    const count = await service.prisma.magicLink.count({ where: { userId } })
    expect(count).toBe(1)
  })

  it('markRedeemed sets the timestamp once (idempotent)', async () => {
    const svc = service.app.get(MagicLinkService)
    const userId = service.user.id
    await svc.recordSent({
      userId,
      email: service.user.email,
      url: 'https://app/serve/welcome?__clerk_ticket=tok',
      expiresAt: inAWeek(),
    })

    const first = await svc.markRedeemed(userId)
    const redeemedAt = first?.redeemedAt
    expect(redeemedAt).toBeInstanceOf(Date)

    const second = await svc.markRedeemed(userId)
    expect(second?.redeemedAt?.getTime()).toBe(redeemedAt?.getTime())
  })

  it('markOnboardingCompleted sets the timestamp once (idempotent)', async () => {
    const svc = service.app.get(MagicLinkService)
    const userId = service.user.id
    await svc.recordSent({
      userId,
      email: service.user.email,
      url: 'https://app/serve/welcome?__clerk_ticket=tok',
      expiresAt: inAWeek(),
    })

    const first = await svc.markOnboardingCompleted(userId)
    const completedAt = first?.onboardingCompletedAt
    expect(completedAt).toBeInstanceOf(Date)

    const second = await svc.markOnboardingCompleted(userId)
    expect(second?.onboardingCompletedAt?.getTime()).toBe(
      completedAt?.getTime(),
    )
  })

  it('mark* is a no-op when the lead has no magic link', async () => {
    const svc = service.app.get(MagicLinkService)
    expect(await svc.markRedeemed(service.user.id)).toBeNull()
    expect(await svc.markOnboardingCompleted(service.user.id)).toBeNull()
  })

  it('recordSent rotates the slug so a resend retires the texted link', async () => {
    const svc = service.app.get(MagicLinkService)
    const userId = service.user.id

    const first = await svc.recordSent({
      userId,
      email: service.user.email,
      url: 'https://app/serve/welcome?__clerk_ticket=tok1',
      expiresAt: inAWeek(),
    })
    expect(first.slug).toMatch(/^[A-Za-z0-9_-]{12}$/)

    const second = await svc.recordSent({
      userId,
      email: service.user.email,
      url: 'https://app/serve/welcome?__clerk_ticket=tok2',
      expiresAt: inAWeek(),
    })

    expect(second.slug).not.toBe(first.slug)
    // The old slug must stop resolving, or two live short links would point at
    // the same lead and the retired one would still hand out a ticket.
    expect(await svc.getBySlug(first.slug!)).toBeNull()
    expect((await svc.getBySlug(second.slug!))?.url).toContain('tok2')
  })

  it('getBySlug returns null for an unknown slug', async () => {
    const svc = service.app.get(MagicLinkService)
    expect(await svc.getBySlug('doesnotexist')).toBeNull()
  })
})

describe('ElectedOfficeController.markMagicLinkRedeemed', () => {
  it("marks the calling lead's link redeemed", async () => {
    const svc = service.app.get(MagicLinkService)
    await svc.recordSent({
      userId: service.user.id,
      email: service.user.email,
      url: 'https://app/serve/welcome?__clerk_ticket=tok',
      expiresAt: inAWeek(),
    })

    const controller = service.app.get(ElectedOfficeController)
    await expect(
      controller.markMagicLinkRedeemed(service.user),
    ).resolves.toEqual({ ok: true })

    const row = await service.prisma.magicLink.findUnique({
      where: { userId: service.user.id },
    })
    expect(row?.redeemedAt).not.toBeNull()
  })

  it('rejects a caller with no user (e.g. an M2M token)', async () => {
    const controller = service.app.get(ElectedOfficeController)
    await expect(
      // The global SessionGuard admits M2M tokens without a user.
      controller.markMagicLinkRedeemed(undefined as never),
    ).rejects.toBeInstanceOf(UnauthorizedException)
  })
})
