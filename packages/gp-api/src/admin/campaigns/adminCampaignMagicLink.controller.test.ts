import { BadRequestException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminCampaignMagicLinkController } from './adminCampaignMagicLink.controller'
import {
  CAMPAIGN_MAGIC_LINK_NAME_REQUIRED_ERROR,
  CreateCampaignMagicLinkDto,
} from './schemas/campaignMagicLink.schema'

// Lightweight unit test of the candidate magic-link handler. The controller
// trims and rejects blank/whitespace names before any provisioning side effects
// run, and builds the /win/welcome redemption URL on success.
function makeController() {
  const usersService = {
    provisionMagicLinkUser: vi.fn().mockResolvedValue({
      user: { id: 1 },
      token: 'tok',
      clerkId: 'clerk_1',
      expiresAt: new Date('2026-01-08T00:00:00.000Z'),
    }),
  }
  const analytics = { track: vi.fn().mockResolvedValue(undefined) }
  const magicLink = {
    recordSent: vi.fn().mockResolvedValue(undefined),
    getByEmail: vi.fn().mockResolvedValue(null),
  }
  const magicLinkDelivery = {
    textActiveLink: vi.fn().mockResolvedValue({ smsSent: true }),
  }
  const logger = { setContext: vi.fn(), info: vi.fn(), warn: vi.fn() }

  const controller = new AdminCampaignMagicLinkController(
    usersService as never,
    analytics as never,
    magicLink as never,
    magicLinkDelivery as never,
    logger as never,
  )
  return { controller, usersService, analytics, magicLink, magicLinkDelivery }
}

const dto = (
  overrides: Partial<CreateCampaignMagicLinkDto>,
): CreateCampaignMagicLinkDto =>
  ({
    email: 'candidate@example.com',
    firstName: 'Jane',
    lastName: 'Doe',
    ...overrides,
  }) as CreateCampaignMagicLinkDto

describe('AdminCampaignMagicLinkController.createMagicLink', () => {
  let ctx: ReturnType<typeof makeController>

  beforeEach(() => {
    ctx = makeController()
  })

  it('rejects a blank first name before provisioning', async () => {
    await expect(
      ctx.controller.createMagicLink(dto({ firstName: '' })),
    ).rejects.toThrow(CAMPAIGN_MAGIC_LINK_NAME_REQUIRED_ERROR)
    expect(ctx.usersService.provisionMagicLinkUser).not.toHaveBeenCalled()
  })

  it('rejects a whitespace-only last name before provisioning', async () => {
    await expect(
      ctx.controller.createMagicLink(dto({ lastName: '   ' })),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(ctx.usersService.provisionMagicLinkUser).not.toHaveBeenCalled()
  })

  it('trims surrounding whitespace before provisioning', async () => {
    await ctx.controller.createMagicLink(
      dto({ firstName: '  Jane  ', lastName: '  Doe  ' }),
    )
    expect(ctx.usersService.provisionMagicLinkUser).toHaveBeenCalledWith(
      expect.objectContaining({ firstName: 'Jane', lastName: 'Doe' }),
    )
  })

  it('returns a /win/welcome redemption URL carrying the sign-in ticket', async () => {
    const result = await ctx.controller.createMagicLink(dto({}))
    expect(result.userId).toBe(1)
    expect(result.url).toContain('/win/welcome?__clerk_ticket=tok')
    // No ElectedOffice is created for candidate leads — that marker would route
    // them into the serve flow instead.
    expect(ctx.analytics.track).toHaveBeenCalledWith(
      1,
      'Onboarding - Magic Link Sent',
      expect.objectContaining({ email: 'candidate@example.com', type: 'win' }),
    )
  })

  it('records the sent lifecycle as a WIN link with the URL + expiry', async () => {
    await ctx.controller.createMagicLink(
      dto({ email: 'candidate@example.com' }),
    )
    expect(ctx.magicLink.recordSent).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 1,
        email: 'candidate@example.com',
        url: expect.stringContaining('/win/welcome?__clerk_ticket=tok'),
        expiresAt: new Date('2026-01-08T00:00:00.000Z'),
        kind: 'WIN',
      }),
    )
  })

  it('does not fail link creation when recording the lifecycle throws', async () => {
    ctx.magicLink.recordSent.mockRejectedValueOnce(new Error('db down'))
    await expect(ctx.controller.createMagicLink(dto({}))).resolves.toEqual(
      expect.objectContaining({ userId: 1 }),
    )
  })
})

describe('AdminCampaignMagicLinkController.getMagicLink', () => {
  let ctx: ReturnType<typeof makeController>
  const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  const PAST = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  beforeEach(() => {
    ctx = makeController()
  })

  it('returns null url + status when no link exists for the email', async () => {
    ctx.magicLink.getByEmail.mockResolvedValueOnce(null)
    await expect(
      ctx.controller.getMagicLink({ email: 'nobody@example.com' } as never),
    ).resolves.toEqual({ url: null, status: null })
  })

  it('returns the URL only while the link is still redeemable (sent)', async () => {
    ctx.magicLink.getByEmail.mockResolvedValueOnce({
      kind: 'WIN',
      url: 'https://gp/win/welcome?__clerk_ticket=tok',
      expiresAt: FUTURE,
      redeemedAt: null,
      onboardingCompletedAt: null,
    })
    await expect(
      ctx.controller.getMagicLink({ email: 'candidate@example.com' } as never),
    ).resolves.toEqual({
      url: 'https://gp/win/welcome?__clerk_ticket=tok',
      status: 'sent',
    })
  })

  it('withholds the URL once the link is redeemed (consumed token)', async () => {
    ctx.magicLink.getByEmail.mockResolvedValueOnce({
      kind: 'WIN',
      url: 'https://gp/win/welcome?__clerk_ticket=tok',
      expiresAt: FUTURE,
      redeemedAt: PAST,
      onboardingCompletedAt: null,
    })
    await expect(
      ctx.controller.getMagicLink({ email: 'candidate@example.com' } as never),
    ).resolves.toEqual({ url: null, status: 'redeemed' })
  })

  it('withholds the URL once the link has expired', async () => {
    ctx.magicLink.getByEmail.mockResolvedValueOnce({
      kind: 'WIN',
      url: 'https://gp/win/welcome?__clerk_ticket=tok',
      expiresAt: PAST,
      redeemedAt: null,
      onboardingCompletedAt: null,
    })
    await expect(
      ctx.controller.getMagicLink({ email: 'candidate@example.com' } as never),
    ).resolves.toEqual({ url: null, status: 'expired' })
  })
})
