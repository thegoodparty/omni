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

  it('returns a generic client-fault message without the raw Prisma message', () => {
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

  // The bug this suite exists to prevent coming back. Each of these is a fault
  // on our side of the wire that was answered with a 400, which the alerting
  // config drops on purpose (EXCLUDED_STATUS_CODES) — so they paged nobody and
  // told the caller not to retry something a retry would have fixed. 8,366 of
  // them in the 30 days to 2026-09-16, 2,147 in prod.
  describe('database faults are reported as server errors', () => {
    it.each([
      ['P2024', 'Timed out fetching a new connection from the connection pool'],
      ['P2028', 'Transaction already closed: ... 5186 ms passed'],
      ['P2034', 'Transaction failed due to a write conflict or a deadlock'],
      ['P1017', 'Server has closed the connection'],
      ['P1008', 'Operations timed out'],
    ])('answers %s with a 503 rather than a 400', (code) => {
      const exc = new Prisma.PrismaClientKnownRequestError('secret detail', {
        code,
        clientVersion: 'x',
      })
      const { host, sent } = makeHost()
      filter.catch(exc, host)

      expect(sent.code).toBe(503)
      expect(sent.body?.error).toBe(
        'The database was briefly unavailable. Please try again.',
      )
      expect(JSON.stringify(sent.body)).not.toContain('secret')
    })

    // Structural faults rather than transient ones: a missing database or a
    // column the schema says exists is not going to fix itself on a retry, so
    // these get a 500 and not a 503. Both were observed in preview, both as
    // 400s.
    it.each([
      ['P1003', 'Database `secret_db` does not exist'],
      ['P2022', 'The column `secret_col` does not exist'],
    ])('answers %s with a 500 rather than a 400', (code) => {
      const exc = new Prisma.PrismaClientKnownRequestError('secret detail', {
        code,
        clientVersion: 'x',
      })
      const { host, sent } = makeHost()
      filter.catch(exc, host)

      expect(sent.code).toBe(500)
      expect(sent.body?.error).toBe(
        'A database error occurred. Please try again later.',
      )
      expect(JSON.stringify(sent.body)).not.toContain('secret')
    })

    // The property that stops this recurring, stated independently of any
    // particular code: an unenumerated fault is ours, not the caller's. If this
    // ever goes back to 400, the next pool timeout Prisma invents is invisible
    // again.
    it('treats a code it has never seen as a server error, not a bad request', () => {
      const exc = new Prisma.PrismaClientKnownRequestError('secret detail', {
        code: 'P9999',
        clientVersion: 'x',
      })
      const { host, sent } = makeHost()
      filter.catch(exc, host)

      expect(sent.code).toBe(500)
      expect(sent.code).toBeGreaterThanOrEqual(500)
    })

    // Guards the direction of the fix as a whole: the codes a caller really can
    // provoke must stay 4xx, or this trades silent server faults for a paging
    // channel any client can open at will.
    it('still answers the caller-caused codes with 4xx', () => {
      for (const code of ['P2002', 'P2025', 'P2000', 'P2003']) {
        const exc = new Prisma.PrismaClientKnownRequestError('x', {
          code,
          clientVersion: 'x',
        })
        const { host, sent } = makeHost()
        filter.catch(exc, host)

        expect(sent.code, `${code} should stay a client error`).toBeLessThan(
          500,
        )
        expect(
          sent.code,
          `${code} should stay a client error`,
        ).toBeGreaterThanOrEqual(400)
      }
    })
  })

  it('returns a generic validation message without the raw query fragment', () => {
    const exc = new Prisma.PrismaClientValidationError(
      'Unknown field `secret_field` for select statement on model `Voter`',
      { clientVersion: 'x' },
    )
    const { host, sent } = makeHost()
    filter.catch(exc, host)

    // 500, not the 400 this used to answer: Prisma rejected the query we built,
    // which breaks the route for every caller until it is fixed.
    expect(sent.code).toBe(500)
    expect(sent.body?.error).toBe(
      'A database error occurred. Please try again later.',
    )
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

    // 500, not the 400 this used to answer: an error Prisma cannot identify is
    // not evidence the caller sent something wrong.
    expect(sent.code).toBe(500)
    expect(sent.body?.error).toBe(
      'An unknown error occured while processing the request.',
    )
    expect(JSON.stringify(sent.body)).not.toContain('secret')
    expect(typeof sent.body?.timestamp).toBe('string')
  })
})
