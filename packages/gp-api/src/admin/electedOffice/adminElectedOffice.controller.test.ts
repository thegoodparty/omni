import { BadRequestException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminElectedOfficeController } from './adminElectedOffice.controller'
import {
  CreateMagicLinkDto,
  MAGIC_LINK_NAME_REQUIRED_ERROR,
} from './schemas/magicLink.schema'

// Lightweight unit test of the magic-link name guard. The controller trims and
// rejects blank/whitespace names before any provisioning side effects run.
function makeController() {
  const usersService = {
    provisionMagicLinkUser: vi.fn().mockResolvedValue({
      user: { id: 1 },
      token: 'tok',
      clerkId: 'clerk_1',
      expiresAt: new Date('2026-01-08T00:00:00.000Z'),
    }),
  }
  const electedOfficeService = {
    create: vi.fn().mockResolvedValue({ id: 'eo_1' }),
  }
  const ballotReadyService = { fetchPersonOfficeHolders: vi.fn() }
  const elections = {
    resolveInternalPositionId: vi.fn(),
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

  const controller = new AdminElectedOfficeController(
    usersService as never,
    electedOfficeService as never,
    ballotReadyService as never,
    elections as never,
    analytics as never,
    magicLink as never,
    magicLinkDelivery as never,
    logger as never,
  )
  return {
    controller,
    usersService,
    electedOfficeService,
    ballotReadyService,
    elections,
    magicLink,
    magicLinkDelivery,
    analytics,
  }
}

const dto = (overrides: Partial<CreateMagicLinkDto>): CreateMagicLinkDto =>
  ({
    email: 'eo@example.com',
    firstName: 'Jane',
    lastName: 'Doe',
    ...overrides,
  }) as CreateMagicLinkDto

describe('AdminElectedOfficeController.createMagicLink', () => {
  let ctx: ReturnType<typeof makeController>

  beforeEach(() => {
    ctx = makeController()
  })

  it('rejects a blank first name before provisioning', async () => {
    await expect(
      ctx.controller.createMagicLink(dto({ firstName: '' })),
    ).rejects.toThrow(MAGIC_LINK_NAME_REQUIRED_ERROR)
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

  it('records the sent magic-link lifecycle with the redemption URL + expiry', async () => {
    await ctx.controller.createMagicLink(dto({ email: 'eo@example.com' }))
    expect(ctx.magicLink.recordSent).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 1,
        email: 'eo@example.com',
        url: expect.stringContaining('/serve/welcome?__clerk_ticket=tok'),
        expiresAt: new Date('2026-01-08T00:00:00.000Z'),
      }),
    )
  })

  it('does not fail link creation when recording the lifecycle throws', async () => {
    ctx.magicLink.recordSent.mockRejectedValueOnce(new Error('db down'))
    await expect(ctx.controller.createMagicLink(dto({}))).resolves.toEqual(
      expect.objectContaining({ userId: 1 }),
    )
  })

  it('tracks the magic-link-sent event tagged as a serve link', async () => {
    await ctx.controller.createMagicLink(dto({}))
    expect(ctx.analytics.track).toHaveBeenCalledWith(
      1,
      'Onboarding - Magic Link Sent',
      expect.objectContaining({ email: 'eo@example.com', type: 'serve' }),
    )
  })

  it('stores election-api internal positionId, not the BallotReady id', async () => {
    // BR returns a current office holder whose position carries the BR id; the
    // elected office must persist the resolved internal id so re-election dating
    // and city-slug resolution (which key on the internal id) work.
    ctx.ballotReadyService.fetchPersonOfficeHolders.mockResolvedValue([
      {
        id: 'oh-1',
        isCurrent: true,
        isVacant: false,
        startAt: '2020-01-01',
        endAt: '2099-01-05',
        position: { id: 'br-pos-1', name: 'Mayor' },
      },
    ])
    ctx.elections.resolveInternalPositionId.mockResolvedValue('pos-internal-1')

    await ctx.controller.createMagicLink(dto({ personId: 'person-1' }))

    expect(ctx.elections.resolveInternalPositionId).toHaveBeenCalledWith(
      'br-pos-1',
    )
    expect(ctx.electedOfficeService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        orgData: expect.objectContaining({ positionId: 'pos-internal-1' }),
      }),
    )
  })
})

describe('AdminElectedOfficeController.getMagicLink', () => {
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
      kind: 'SERVE',
      url: 'https://gp/serve/welcome?__clerk_ticket=tok',
      expiresAt: FUTURE,
      redeemedAt: null,
      onboardingCompletedAt: null,
    })
    await expect(
      ctx.controller.getMagicLink({ email: 'eo@example.com' } as never),
    ).resolves.toEqual({
      url: 'https://gp/serve/welcome?__clerk_ticket=tok',
      status: 'sent',
    })
  })

  it('withholds the URL once the link is redeemed (consumed token)', async () => {
    ctx.magicLink.getByEmail.mockResolvedValueOnce({
      kind: 'SERVE',
      url: 'https://gp/serve/welcome?__clerk_ticket=tok',
      expiresAt: FUTURE,
      redeemedAt: PAST,
      onboardingCompletedAt: null,
    })
    await expect(
      ctx.controller.getMagicLink({ email: 'eo@example.com' } as never),
    ).resolves.toEqual({ url: null, status: 'redeemed' })
  })

  it('withholds the URL once the link has expired', async () => {
    ctx.magicLink.getByEmail.mockResolvedValueOnce({
      kind: 'SERVE',
      url: 'https://gp/serve/welcome?__clerk_ticket=tok',
      expiresAt: PAST,
      redeemedAt: null,
      onboardingCompletedAt: null,
    })
    await expect(
      ctx.controller.getMagicLink({ email: 'eo@example.com' } as never),
    ).resolves.toEqual({ url: null, status: 'expired' })
  })
})
