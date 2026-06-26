import { ArgumentsHost } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import { Prisma } from '../generated/prisma'
import { createMockLogger } from '@/shared/test-utils/mockLogger.util'
import { PrismaExceptionFilter } from './prisma-exception.filter'

const makeHost = () => {
  const sent: { code?: number; body?: Record<string, unknown> } = {}
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({
        status: (code: number) => ({
          send: (body: Record<string, unknown>) => {
            sent.code = code
            sent.body = body
          },
        }),
      }),
      getRequest: () => ({ url: '/v1/public-campaigns', method: 'POST' }),
    }),
  } as unknown as ArgumentsHost
  return { host, sent }
}

describe('PrismaExceptionFilter', () => {
  const filter = new PrismaExceptionFilter(createMockLogger())

  it('returns a generic P2002 message without the leaking constraint/column', () => {
    const exc = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on the fields: (`email`)',
      { code: 'P2002', clientVersion: 'x', meta: { target: ['email'] } },
    )
    const { host, sent } = makeHost()
    filter.catch(exc, host)

    expect(sent.code).toBe(409)
    expect(sent.body?.error).toBe(
      'A record with the provided value already exists',
    )
    expect(JSON.stringify(sent.body)).not.toContain('email')
    // Guards the response shape — timestamp must be a real ISO string (a missing
    // `()` on toISOString would make JSON.stringify silently drop the field).
    expect(typeof sent.body?.timestamp).toBe('string')
  })

  it('returns a generic default-branch message without the raw Prisma message', () => {
    const exc = new Prisma.PrismaClientKnownRequestError(
      'Value too long for column `secret_internal_col`',
      { code: 'P2000', clientVersion: 'x' },
    )
    const { host, sent } = makeHost()
    filter.catch(exc, host)

    expect(sent.code).toBe(400)
    expect(sent.body?.error).toBe('The request could not be completed')
    expect(JSON.stringify(sent.body)).not.toContain('secret_internal_col')
  })

  it('returns a generic validation message without the raw query fragment', () => {
    const exc = new Prisma.PrismaClientValidationError(
      'Unknown field `secret_field` for select statement on model `Voter`',
      { clientVersion: 'x' },
    )
    const { host, sent } = makeHost()
    filter.catch(exc, host)

    expect(sent.code).toBe(400)
    expect(sent.body?.error).toBe('Invalid request data')
    expect(JSON.stringify(sent.body)).not.toContain('secret_field')
  })

  it('returns a generic initialization message without the raw connection detail', () => {
    const exc = new Prisma.PrismaClientInitializationError(
      'Cannot reach database server at secret-host.internal:5432',
      'x',
    )
    const { host, sent } = makeHost()
    filter.catch(exc, host)

    expect(sent.code).toBe(500)
    expect(sent.body?.error).toBe(
      'A database error occurred. Please try again later.',
    )
    expect(JSON.stringify(sent.body)).not.toContain('secret-host')
  })

  it('returns a generic rust-panic message without the raw exception detail', () => {
    const exc = new Prisma.PrismaClientRustPanicError(
      'Rust panic: internal secret detail',
      'x',
    )
    const { host, sent } = makeHost()
    filter.catch(exc, host)

    expect(sent.code).toBe(500)
    expect(sent.body?.error).toBe(
      'A Prisma internal error occured. Please try again later.',
    )
    expect(JSON.stringify(sent.body)).not.toContain('secret')
    expect(typeof sent.body?.timestamp).toBe('string')
  })

  it('returns a generic unknown-request message without the raw exception detail', () => {
    const exc = new Prisma.PrismaClientUnknownRequestError(
      'Unknown error: secret-internal-detail',
      { clientVersion: 'x' },
    )
    const { host, sent } = makeHost()
    filter.catch(exc, host)

    expect(sent.code).toBe(400)
    expect(sent.body?.error).toBe(
      'An unknown error occured while processing the request.',
    )
    expect(JSON.stringify(sent.body)).not.toContain('secret')
    expect(typeof sent.body?.timestamp).toBe('string')
  })
})
