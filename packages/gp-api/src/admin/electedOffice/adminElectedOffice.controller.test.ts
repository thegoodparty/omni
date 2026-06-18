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
  const analytics = { track: vi.fn().mockResolvedValue(undefined) }
  const logger = { setContext: vi.fn(), info: vi.fn(), warn: vi.fn() }

  const controller = new AdminElectedOfficeController(
    usersService as never,
    electedOfficeService as never,
    ballotReadyService as never,
    analytics as never,
    logger as never,
  )
  return { controller, usersService, electedOfficeService }
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
})
