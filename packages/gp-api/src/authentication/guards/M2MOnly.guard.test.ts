import { ExecutionContext } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import { IncomingRequest } from '@/authentication/authentication.types'
import { M2MOnly } from './M2MOnly.guard'

const buildContext = (req: IncomingRequest): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => req }),
  }) as unknown as ExecutionContext

describe('M2MOnly', () => {
  const guard = new M2MOnly()

  it('allows requests carrying a verified M2M token', async () => {
    const req = {
      m2mToken: { id: 'm2m_1', subject: 'machine_abc' },
    } as IncomingRequest

    await expect(guard.canActivate(buildContext(req))).resolves.toBe(true)
  })

  it('denies requests without an M2M token', async () => {
    const req = {} as IncomingRequest

    await expect(guard.canActivate(buildContext(req))).resolves.toBe(false)
  })

  it('denies an authenticated user request that lacks an M2M token', async () => {
    const req = { user: { id: 1 } } as unknown as IncomingRequest

    await expect(guard.canActivate(buildContext(req))).resolves.toBe(false)
  })
})
