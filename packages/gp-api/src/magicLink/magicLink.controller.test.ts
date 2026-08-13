import { describe, expect, it } from 'vitest'
import { useTestService } from '../test-service'
import { MagicLinkController } from './magicLink.controller'
import { MagicLinkService } from './magicLink.service'

const service = useTestService()

const inAWeek = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
const anHourAgo = () => new Date(Date.now() - 60 * 60 * 1000)

const URL_WITH_TICKET = 'https://app/serve/welcome?__clerk_ticket=tok'

const sendLink = async (expiresAt = inAWeek()) => {
  const record = await service.app.get(MagicLinkService).recordSent({
    userId: service.user.id,
    email: service.user.email,
    url: URL_WITH_TICKET,
    expiresAt,
  })
  return record.slug!
}

describe('MagicLinkController.resolve', () => {
  it('returns the redemption URL while the link is still sent', async () => {
    const slug = await sendLink()

    await expect(
      service.app.get(MagicLinkController).resolve({ slug }),
    ).resolves.toEqual({ url: URL_WITH_TICKET, status: 'sent' })
  })

  it('withholds the URL once the link has been redeemed', async () => {
    const slug = await sendLink()
    await service.app.get(MagicLinkService).markRedeemed(service.user.id)

    await expect(
      service.app.get(MagicLinkController).resolve({ slug }),
    ).resolves.toEqual({ url: null, status: 'redeemed' })
  })

  it('withholds the URL once the link has expired', async () => {
    const slug = await sendLink(anHourAgo())

    await expect(
      service.app.get(MagicLinkController).resolve({ slug }),
    ).resolves.toEqual({ url: null, status: 'expired' })
  })

  it('returns nothing for an unknown slug', async () => {
    await expect(
      service.app.get(MagicLinkController).resolve({ slug: 'nosuchslug12' }),
    ).resolves.toEqual({ url: null, status: null })
  })

  it('does not consume the ticket', async () => {
    const slug = await sendLink()
    const controller = service.app.get(MagicLinkController)

    // Resolving is a pure lookup: the /serve/welcome button gate is what marks
    // the link redeemed. If resolving consumed it, a link scanner following the
    // texted URL would burn the ticket before the lead ever tapped it.
    await controller.resolve({ slug })
    await controller.resolve({ slug })

    const row = await service.prisma.magicLink.findUnique({
      where: { userId: service.user.id },
    })
    expect(row?.redeemedAt).toBeNull()
    expect(row?.onboardingCompletedAt).toBeNull()
  })
})
