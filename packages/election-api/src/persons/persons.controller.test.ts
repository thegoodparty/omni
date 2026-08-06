import { UnauthorizedException } from '@nestjs/common'
import { FastifyRequest } from 'fastify'
import { describe, expect, it, vi } from 'vitest'
import { PersonsController } from './persons.controller'
import { PersonsService } from './persons.service'
import { PersonFilterDto } from './persons.schema'

// The gpApiUserId filter exposes an internal gp-api user↔person linkage, so the
// controller must keep it service-to-service: allowed only when M2MAuthGuard
// has tagged the request with a verified `m2mToken`, independent of the global
// ELECTION_API_AUTH_ENFORCED rollout flag.
const makeController = () => {
  const getPersons = vi.fn().mockResolvedValue([{ id: 'p1' }])
  const controller = new PersonsController({
    getPersons,
  } as unknown as PersonsService)
  return { controller, getPersons }
}

const req = (m2mToken?: unknown) =>
  ({ m2mToken }) as unknown as FastifyRequest & { m2mToken?: unknown }

describe('PersonsController — gpApiUserId is M2M-only', () => {
  it('rejects a gpApiUserId filter from an unauthenticated caller', async () => {
    const { controller, getPersons } = makeController()

    await expect(
      controller.getPersons({ gpApiUserId: '12345' } as PersonFilterDto, req()),
    ).rejects.toBeInstanceOf(UnauthorizedException)
    // Never reaches the service — no enumeration oracle for public callers.
    expect(getPersons).not.toHaveBeenCalled()
  })

  it('allows a gpApiUserId filter for a verified M2M caller', async () => {
    const { controller, getPersons } = makeController()

    const result = await controller.getPersons(
      { gpApiUserId: '12345' } as PersonFilterDto,
      req({ id: 'machine-1' }),
    )

    expect(getPersons).toHaveBeenCalledWith({ gpApiUserId: '12345' })
    expect(result).toEqual([{ id: 'p1' }])
  })

  it('leaves public (non-gpApiUserId) filters open to unauthenticated callers', async () => {
    const { controller, getPersons } = makeController()

    await controller.getPersons({ state: 'CA' } as PersonFilterDto, req())

    expect(getPersons).toHaveBeenCalledWith({ state: 'CA' })
  })
})
