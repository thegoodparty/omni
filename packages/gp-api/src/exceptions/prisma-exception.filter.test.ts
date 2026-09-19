import { ArgumentsHost } from '@nestjs/common'
import { describe, expect, it } from 'vitest'
import { Prisma } from '../generated/prisma'
import { Prisma as PeoplePrisma } from '../generated/people-prisma'
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

  // gp-api generates TWO Prisma clients, and each bundles its own runtime, so
  // the people-db client's error classes are not the main client's. This filter
  // used to reference only the main set, so everything the people-db client
  // raised fell past it to Nest's default handler — 1,498,324 unclassified
  // failures on GET /v1/public-person-profiles/voter-density between
  // 2026-08-24 and 2026-08-28.
  //
  // The assertions below are deliberately written as "identical to the main
  // client" rather than against literal numbers. What matters is not that a
  // people-db P2024 is 503; it is that which client raised an error cannot
  // change the answer. A future edit to the mapping should move both or fail.
  describe('the people-db client is classified like the main one', () => {
    const bothClients = (code: string) => {
      const main = makeHost()
      filter.catch(
        new Prisma.PrismaClientKnownRequestError('x', {
          code,
          clientVersion: 'x',
        }),
        main.host,
      )

      const people = makeHost()
      filter.catch(
        new PeoplePrisma.PrismaClientKnownRequestError('x', {
          code,
          clientVersion: 'x',
        }),
        people.host,
      )

      return { main: main.sent, people: people.sent }
    }

    it.each([
      ['P2021', 'the code that caused the voter-density outage'],
      ['P2024', 'a transient pool timeout'],
      ['P2025', 'a caller-caused not-found'],
      ['P2002', 'a caller-caused conflict'],
    ])('answers %s the same from either client (%s)', (code) => {
      const { main, people } = bothClients(code)

      expect(people.code).toBe(main.code)
      expect(people.body?.error).toBe(main.body?.error)
    })

    // The specific regression: a people-db error must be HANDLED here, not
    // re-thrown for someone else to turn into an anonymous 500. `catch`
    // re-throws anything it cannot classify, so an unhandled people-db error
    // shows up as this call throwing rather than as a wrong status code.
    it('handles a people-db error instead of re-throwing it', () => {
      const { host, sent } = makeHost()

      expect(() =>
        filter.catch(
          new PeoplePrisma.PrismaClientKnownRequestError('x', {
            code: 'P2021',
            clientVersion: 'x',
          }),
          host,
        ),
      ).not.toThrow()
      expect(sent.code).toBe(500)
    })

    // Everything else in this block calls `filter.catch` directly, which is not
    // how the filter is reached in production: Nest first decides whether this
    // filter handles the error at all, by testing it against the `@Catch(...)`
    // list with `instanceof`. Dropping the people-db classes from that list
    // would restore the original bug — errors never reaching this filter — and
    // every other test here would still pass, because they skip that step.
    //
    // So this reproduces Nest's own check rather than asserting the list's
    // contents, which would only restate the source.
    it('is reached by Nest for a people-db error', () => {
      const catchTypes: (new (...args: never[]) => Error)[] =
        Reflect.getMetadata(
          '__filterCatchExceptions__',
          PrismaExceptionFilter,
        ) ?? []

      const peopleDbError = new PeoplePrisma.PrismaClientKnownRequestError(
        'x',
        { code: 'P2021', clientVersion: 'x' },
      )

      expect(catchTypes.some((type) => peopleDbError instanceof type)).toBe(
        true,
      )
    })

    it('classifies the people-db non-request error classes too', () => {
      const { host, sent } = makeHost()
      filter.catch(
        new PeoplePrisma.PrismaClientValidationError('secret', {
          clientVersion: 'x',
        }),
        host,
      )

      expect(sent.code).toBe(500)
      expect(JSON.stringify(sent.body)).not.toContain('secret')
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
