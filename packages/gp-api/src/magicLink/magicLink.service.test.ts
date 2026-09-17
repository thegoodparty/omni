import { UnauthorizedException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import { ElectedOfficeController } from '../electedOffice/electedOffice.controller'
import { useTestService } from '../test-service'
import { MagicLinkKind } from '../generated/prisma'
import { MagicLinkService } from './magicLink.service'
import { computeMagicLinkStatus } from './util/magicLinkStatus.util'

const service = useTestService()

const inAWeek = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

describe('MagicLinkService', () => {
  it('recordSent keeps one row per user and kind, and a resend is textable again', async () => {
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
    await svc.markRedeemed(userId, MagicLinkKind.SERVE)
    const second = await svc.recordSent({
      userId,
      email: service.user.email,
      url: 'https://app/serve/welcome?__clerk_ticket=tok2',
      expiresAt: inAWeek(),
    })

    expect(second.url).toContain('tok2')

    // The resend is a new link, so it carries the previous one's lifecycle
    // nowhere. This is what lets the mint-then-text flow work for a returning
    // lead: both admin controllers text straight after recordSent, and
    // textActiveLink refuses to send anything whose status is not 'sent'.
    expect(second.redeemedAt).toBeNull()
    expect(second.onboardingCompletedAt).toBeNull()
    expect(computeMagicLinkStatus(second)).toBe('sent')

    const count = await service.prisma.magicLink.count({ where: { userId } })
    expect(count).toBe(1)
  })

  it("a WIN send does not overwrite the same lead's SERVE link", async () => {
    const svc = service.app.get(MagicLinkService)
    const userId = service.user.id

    // A rep mints a serve link from admin/elected-office/magic-link...
    const serve = await svc.recordSent({
      userId,
      email: service.user.email,
      url: 'https://app/serve/welcome?__clerk_ticket=serve-tok',
      expiresAt: inAWeek(),
      kind: MagicLinkKind.SERVE,
    })
    // ...and the lead redeems it.
    await svc.markRedeemed(userId, MagicLinkKind.SERVE)

    // Later the same person is sent down the win funnel. provisionMagicLinkUser
    // resolves the same email to the same User, so this used to collide on the
    // unique userId and overwrite everything above.
    const win = await svc.recordSent({
      userId,
      email: service.user.email,
      url: 'https://app/win/welcome?__clerk_ticket=win-tok',
      expiresAt: inAWeek(),
      kind: MagicLinkKind.WIN,
    })

    expect(win.id).not.toBe(serve.id)
    expect(await service.prisma.magicLink.count({ where: { userId } })).toBe(2)

    // The serve row is untouched: same url, same slug (so the short link
    // already texted to the lead still resolves), and its redemption intact.
    const serveAfter = await svc.getByUserId(userId, MagicLinkKind.SERVE)
    expect(serveAfter?.url).toContain('serve-tok')
    expect(serveAfter?.slug).toBe(serve.slug)
    expect(serveAfter?.redeemedAt).not.toBeNull()

    // And the two funnels track their lifecycles separately.
    expect(
      (await svc.getByUserId(userId, MagicLinkKind.WIN))?.redeemedAt,
    ).toBeNull()
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

    const first = await svc.markRedeemed(userId, MagicLinkKind.SERVE)
    const redeemedAt = first?.redeemedAt
    expect(redeemedAt).toBeInstanceOf(Date)

    const second = await svc.markRedeemed(userId, MagicLinkKind.SERVE)
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

    const first = await svc.markOnboardingCompleted(userId, MagicLinkKind.SERVE)
    const completedAt = first?.onboardingCompletedAt
    expect(completedAt).toBeInstanceOf(Date)

    const second = await svc.markOnboardingCompleted(
      userId,
      MagicLinkKind.SERVE,
    )
    expect(second?.onboardingCompletedAt?.getTime()).toBe(
      completedAt?.getTime(),
    )
  })

  it('mark* is a no-op when the lead has no magic link', async () => {
    const svc = service.app.get(MagicLinkService)
    expect(
      await svc.markRedeemed(service.user.id, MagicLinkKind.SERVE),
    ).toBeNull()
    expect(
      await svc.markOnboardingCompleted(service.user.id, MagicLinkKind.SERVE),
    ).toBeNull()
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
      where: {
        userId_kind: {
          userId: service.user.id,
          kind: MagicLinkKind.SERVE,
        },
      },
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
