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
    }),
  }
  const analytics = { track: vi.fn().mockResolvedValue(undefined) }
  const logger = { setContext: vi.fn(), info: vi.fn(), warn: vi.fn() }

  const controller = new AdminCampaignMagicLinkController(
    usersService as never,
    analytics as never,
    logger as never,
  )
  return { controller, usersService, analytics }
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
})
