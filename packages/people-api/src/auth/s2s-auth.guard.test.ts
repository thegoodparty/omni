import { ExecutionContext, UnauthorizedException } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import jwt from 'jsonwebtoken'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { S2SAuthGuard } from './s2s-auth.guard'

const SECRET = 'test-s2s-secret'

function makeContext(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext
}

describe('S2SAuthGuard', () => {
  let guard: S2SAuthGuard
  let reflector: { getAllAndOverride: ReturnType<typeof vi.fn> }
  const originalEnv = { ...process.env }

  beforeEach(() => {
    reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) }
    guard = new S2SAuthGuard(reflector as unknown as Reflector)
    process.env.PEOPLE_API_S2S_SECRET = SECRET
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('does NOT bypass auth for a spoofed Host: localhost from a non-loopback IP', () => {
    process.env.S2S_ALLOW_LOCALHOST = 'true'
    const ctx = makeContext({
      headers: {},
      ip: '203.0.113.7',
      hostname: 'localhost',
    })
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException)
  })

  it('allows the localhost bypass only from the real loopback socket address', () => {
    process.env.S2S_ALLOW_LOCALHOST = 'true'
    for (const ip of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      const ctx = makeContext({ headers: {}, ip, hostname: 'evil.example.com' })
      expect(guard.canActivate(ctx)).toBe(true)
    }
  })

  it('does not bypass from loopback when S2S_ALLOW_LOCALHOST is off', () => {
    delete process.env.S2S_ALLOW_LOCALHOST
    const ctx = makeContext({ headers: {}, ip: '127.0.0.1', hostname: 'x' })
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException)
  })

  it('accepts a valid Bearer token regardless of host/ip', () => {
    const token = jwt.sign({ iss: 'gp-api' }, SECRET)
    const request: Record<string, unknown> = {
      headers: { authorization: `Bearer ${token}` },
      ip: '203.0.113.7',
      hostname: 'people-api',
    }
    expect(guard.canActivate(makeContext(request))).toBe(true)
    expect(request.s2s).toBeDefined()
  })

  it('rejects an invalid Bearer token', () => {
    const ctx = makeContext({
      headers: { authorization: 'Bearer not-a-real-token' },
      ip: '127.0.0.1',
    })
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException)
  })

  it('allows routes marked public', () => {
    reflector.getAllAndOverride.mockReturnValue(true)
    const ctx = makeContext({ headers: {}, ip: '203.0.113.7' })
    expect(guard.canActivate(ctx)).toBe(true)
  })
})
