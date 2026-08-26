import { GatewayTimeoutException, Logger } from '@nestjs/common'
import { Prisma } from '../../generated/people-prisma'
import { PeopleDbPrismaClient } from '../peopleDb.service'
import { isStatementTimeoutError } from './statementTimeout.util'

// One statement, read in chunks. The alternative for a result set too large to
// hold in memory is keyset pagination, and for a joined scan that is a trap:
// the cursor predicate reaches only the driving side of the join, so every
// page re-walks the other side from the start and the pass turns quadratic.
// Measured on the door-knocking pack (628k rows, `docs/perf/voter-pack-profile.md`):
//
//   | | keyset, 13 statements | one statement through a cursor |
//   | blocks touched   | 14,058,235 | 120,976 |
//   | read from storage| 11.5 GB    | 945 MB  |
//
// A server-side cursor keeps the memory bound that pagination was there for
// without re-executing anything: the plan runs once and rows are handed back
// `CURSOR_FETCH_SIZE` at a time.
const CURSOR_NAME = 'people_db_scan'

export const CURSOR_FETCH_SIZE = 50_000

// Higher than the 25s every single-shot query gets, and deliberately so. The
// statement clock is armed per FETCH (not for the cursor's lifetime), and the
// FIRST fetch is the one that pays for the whole plan's startup — a hash build
// over the district — where a keyset page only ever paid for its own slice. A
// scan whose total is comfortably inside 25s can still spend most of it in
// fetch one. The ceiling that matters to a user is the client's, which gives up
// at 90s; this sits under that so Postgres kills a pathological plan before the
// browser walks away from one.
export const CURSOR_STATEMENT_TIMEOUT_MS = 45_000

// The whole scan, not one fetch. Past this nobody is waiting: the webapp has
// already aborted and the gateway is about to. Bounding the transaction stops
// an abandoned scan from holding a connection and a snapshot open behind it.
export const CURSOR_TRANSACTION_TIMEOUT_MS = 85_000

const CURSOR_MAX_WAIT_MS = 10_000

type CursorScanOptions<T> = {
  logger: Logger
  timeoutMessage: string
  // Checked between fetches. A caller whose reader has gone away (a destroyed
  // response, a closed tab) stops the scan here rather than paying for the
  // rest of a district nobody will read.
  signal?: AbortSignal
  onRows: (rows: T[]) => void
}

export class AbandonedScanError extends Error {}

// Runs `sql` once and feeds its rows to `onRows` in batches, under the same
// statement-timeout discipline as every other people-db query (see
// `peopleDb/AGENTS.md`). `SET LOCAL` scopes both settings to this transaction.
export const scanUnderCursor = async <T>(
  client: PeopleDbPrismaClient,
  sql: Prisma.Sql,
  { logger, timeoutMessage, signal, onRows }: CursorScanOptions<T>,
): Promise<void> => {
  const startedAt = Date.now()
  try {
    await client.$transaction(
      async (tx) => {
        // SET takes no bind parameters, and both values are compile-time
        // constants, so Prisma.raw is safe here.
        await tx.$executeRaw(
          Prisma.raw(
            `SET LOCAL statement_timeout = '${CURSOR_STATEMENT_TIMEOUT_MS}ms'`,
          ),
        )
        // Without this the planner optimises for a fast first row, because a
        // cursor usually means "show me a page". This one always drains, so
        // tell it to cost the whole result — otherwise it can pick the
        // fast-start plan whose total cost is exactly what this change exists
        // to avoid.
        await tx.$executeRaw(Prisma.raw('SET LOCAL cursor_tuple_fraction = 1'))
        await tx.$executeRaw(
          Prisma.sql`DECLARE ${Prisma.raw(CURSOR_NAME)} NO SCROLL CURSOR FOR ${sql}`,
        )

        for (;;) {
          if (signal?.aborted) {
            throw new AbandonedScanError('scan abandoned: the client is gone')
          }
          const rows = await tx.$queryRaw<T[]>(
            Prisma.raw(
              `FETCH FORWARD ${CURSOR_FETCH_SIZE} FROM ${CURSOR_NAME}`,
            ),
          )
          onRows(rows)
          if (rows.length < CURSOR_FETCH_SIZE) return
        }
      },
      {
        timeout: CURSOR_TRANSACTION_TIMEOUT_MS,
        maxWait: CURSOR_MAX_WAIT_MS,
      },
    )
  } catch (error) {
    if (!isStatementTimeoutError(error)) {
      throw error
    }
    logger.error(
      { err: error, elapsedMs: Date.now() - startedAt },
      'people-db cursor scan exceeded the statement timeout',
    )
    throw new GatewayTimeoutException(timeoutMessage)
  }
}
