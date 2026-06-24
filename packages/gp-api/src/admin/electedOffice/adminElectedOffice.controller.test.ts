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
  const logger = { setContext: vi.fn(), info: vi.fn(), warn: vi.fn() }

  const controller = new AdminElectedOfficeController(
    usersService as never,
    electedOfficeService as never,
    ballotReadyService as never,
    elections as never,
    analytics as never,
    logger as never,
  )
  return {
    controller,
    usersService,
    electedOfficeService,
    ballotReadyService,
    elections,
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
