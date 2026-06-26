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

  beforeEach(() => {
    reflector = { getAllAndOverride: vi.fn().mockReturnValue(false) }
    guard = new S2SAuthGuard(reflector as unknown as Reflector)
    vi.stubEnv('PEOPLE_API_S2S_SECRET', SECRET)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('does NOT bypass auth for a spoofed Host: localhost from a non-loopback IP', () => {
    vi.stubEnv('S2S_ALLOW_LOCALHOST', 'true')
    const ctx = makeContext({
      headers: {},
      ip: '203.0.113.7',
      hostname: 'localhost',
    })
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException)
  })

  it('allows the localhost bypass only from the real loopback socket address', () => {
    vi.stubEnv('S2S_ALLOW_LOCALHOST', 'true')
    for (const ip of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      const ctx = makeContext({ headers: {}, ip, hostname: 'evil.example.com' })
      expect(guard.canActivate(ctx)).toBe(true)
    }
  })

  it('does not bypass from loopback when S2S_ALLOW_LOCALHOST is off', () => {
    vi.stubEnv('S2S_ALLOW_LOCALHOST', undefined)
    const ctx = makeContext({ headers: {}, ip: '127.0.0.1', hostname: 'x' })
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException)
  })

  it('treats non-truthy S2S_ALLOW_LOCALHOST values as off', () => {
    // 'false1' specifically guards the alternation-precedence regex fix —
    // the old /^true|1|yes$/ matched any string containing '1'.
    for (const value of ['false', '0', 'no', 'false1']) {
      vi.stubEnv('S2S_ALLOW_LOCALHOST', value)
      const ctx = makeContext({ headers: {}, ip: '127.0.0.1' })
      expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException)
    }
  })

  const signValid = (overrides: Record<string, unknown> = {}) => {
    const now = Math.floor(Date.now() / 1000)
    return jwt.sign(
      {
        iss: 'gp-api',
        aud: 'people-api',
        iat: now,
        exp: now + 300,
        ...overrides,
      },
      SECRET,
    )
  }

  it('accepts a valid Bearer token regardless of host/ip', () => {
    const request: Record<string, unknown> = {
      headers: { authorization: `Bearer ${signValid()}` },
      ip: '203.0.113.7',
      hostname: 'people-api',
    }
    expect(guard.canActivate(makeContext(request))).toBe(true)
    expect(request.s2s).toBeDefined()
  })

  it('rejects a token with the wrong issuer', () => {
    const ctx = makeContext({
      headers: { authorization: `Bearer ${signValid({ iss: 'evil' })}` },
      ip: '127.0.0.1',
    })
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException)
  })

  it('rejects a token with the wrong audience', () => {
    const ctx = makeContext({
      headers: {
        authorization: `Bearer ${signValid({ aud: 'someone-else' })}`,
      },
      ip: '127.0.0.1',
    })
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException)
  })

  it('rejects an unbounded (no-exp) token older than maxAge', () => {
    // jsonwebtoken only enforces exp when present; maxAge bounds lifetime via
    // iat, so a token minted without exp cannot be replayed indefinitely.
    const stale = Math.floor(Date.now() / 1000) - 600
    const token = jwt.sign(
      { iss: 'gp-api', aud: 'people-api', iat: stale },
      SECRET,
    )
    const ctx = makeContext({
      headers: { authorization: `Bearer ${token}` },
      ip: '127.0.0.1',
    })
    expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException)
  })

  it('accepts a no-exp token while still within maxAge', () => {
    // Guards against maxAge being set too tight: a fresh token without exp is
    // still valid until it ages past maxAge.
    const now = Math.floor(Date.now() / 1000)
    const token = jwt.sign(
      { iss: 'gp-api', aud: 'people-api', iat: now },
      SECRET,
    )
    const ctx = makeContext({
      headers: { authorization: `Bearer ${token}` },
      ip: '127.0.0.1',
    })
    expect(guard.canActivate(ctx)).toBe(true)
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
