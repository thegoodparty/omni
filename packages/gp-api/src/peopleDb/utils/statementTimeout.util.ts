import { GatewayTimeoutException, Logger } from '@nestjs/common'
import { Prisma } from '../../generated/people-prisma'
import { PeopleDbPrismaClient } from '../peopleDb.service'

// A hard ceiling on any people-db query run through the Prisma client. An
// honest statewide filtered count is a full-partition scan that lands around
// 3-4 seconds (the largest legitimate case); anything past this ceiling is a
// pathological plan we want to fail loudly and alert on, not silently degrade
// into a wrong answer. Streaming CSV downloads run on a separate pool and set
// their own timeout, so this does not bound them.
export const STATEMENT_TIMEOUT_MS = 25_000

export const isStatementTimeoutError = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  ((error.meta as { code?: unknown } | undefined)?.code === '57014' ||
    error.message.includes('57014'))

// Every people-db query runs under a hard statement timeout so a pathological
// plan fails loudly (a classified 504 we can alert on) instead of holding a
// connection open or silently degrading into a wrong answer. No retry and no
// fenced fallback: a slow query is either a genuine large scan (well under the
// ceiling) or a bug we want surfaced.
//
// Without it a slow query is bounded only by the connection's `socket_timeout`
// (60s, set in peopleDb.service.ts). That is strictly worse than a statement
// timeout: the socket timeout abandons the connection client-side while the
// query keeps running ON the database, so the request burns people-db CPU for
// another 35s after nobody is waiting for it, and it surfaces as an
// unclassifiable `P2010 Code: N/A` rather than SQLSTATE 57014. Measured in prod
// 2026-08-20: the one path that lacked this (door-knocking `residents()`) took
// 60,209ms and 500'd, while every guarded path in the same window failed
// cleanly at 25,011-25,016ms.
//
// SET LOCAL only holds for the transaction it runs in, and Prisma batch
// transactions execute on a single connection, so the timeout scopes to
// exactly this query.
export const runUnderStatementTimeout = async <T>(
  client: PeopleDbPrismaClient,
  sql: Prisma.Sql,
  logger: Logger,
  timeoutMessage: string,
  timeoutMs: number = STATEMENT_TIMEOUT_MS,
): Promise<T[]> => {
  const startedAt = Date.now()
  try {
    // SET does not accept bind parameters; the interval is a compile-time
    // constant, so Prisma.raw is safe here.
    const [, rows] = await client.$transaction([
      client.$executeRaw(
        Prisma.raw(`SET LOCAL statement_timeout = '${timeoutMs}ms'`),
      ),
      client.$queryRaw<T[]>(sql),
    ])
    return rows
  } catch (error) {
    if (!isStatementTimeoutError(error)) {
      throw error
    }
    logger.error(
      { err: error, elapsedMs: Date.now() - startedAt },
      'people-db query exceeded the statement timeout',
    )
    throw new GatewayTimeoutException(timeoutMessage)
  }
}
