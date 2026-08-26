import { Logger } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma } from '../../generated/people-prisma'
import type { PeopleDbPrismaClient } from '../peopleDb.service'
import {
  AbandonedScanError,
  CURSOR_FETCH_SIZE,
  CURSOR_STATEMENT_TIMEOUT_MS,
  CURSOR_TRANSACTION_TIMEOUT_MS,
  scanUnderCursor,
} from './cursorScan.util'

const SQL = Prisma.sql`SELECT v."id" FROM "green"."Voter" v`

describe('scanUnderCursor', () => {
  let client: {
    $queryRaw: ReturnType<typeof vi.fn>
    $executeRaw: ReturnType<typeof vi.fn>
    $transaction: ReturnType<typeof vi.fn>
  }
  const logger = { error: vi.fn() } as unknown as Logger

  const run = (options: Partial<Parameters<typeof scanUnderCursor>[2]> = {}) =>
    scanUnderCursor(client as unknown as PeopleDbPrismaClient, SQL, {
      logger,
      timeoutMessage: 'took too long',
      onRows: () => undefined,
      ...options,
    })

  const executedText = () =>
    client.$executeRaw.mock.calls.map(([sql]) =>
      (sql as Prisma.Sql).strings.join('?'),
    )

  beforeEach(() => {
    client = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      $executeRaw: vi.fn().mockResolvedValue(0),
      $transaction: vi.fn((body: (tx: unknown) => Promise<unknown>) =>
        body(client),
      ),
    }
  })

  it('declares one cursor over the statement and fetches until a short chunk', async () => {
    const chunks: number[] = []
    client.$queryRaw
      .mockResolvedValueOnce(new Array<number>(CURSOR_FETCH_SIZE).fill(1))
      .mockResolvedValueOnce([1, 2, 3])

    await run({ onRows: (rows) => chunks.push(rows.length) })

    expect(executedText().at(-1)).toContain('CURSOR FOR')
    expect(executedText().at(-1)).toContain('FROM "green"."Voter"')
    expect(chunks).toEqual([CURSOR_FETCH_SIZE, 3])
    expect(client.$queryRaw).toHaveBeenCalledTimes(2)
  })

  it('bounds each fetch and the scan as a whole', async () => {
    await run()

    expect(executedText()[0]).toContain(
      `statement_timeout = '${CURSOR_STATEMENT_TIMEOUT_MS}ms'`,
    )
    expect(client.$transaction.mock.calls[0]?.[1]).toMatchObject({
      timeout: CURSOR_TRANSACTION_TIMEOUT_MS,
    })
    // The per-fetch clock has to leave room for the client's own 90s deadline,
    // or Postgres never gets to kill a pathological plan first.
    expect(CURSOR_STATEMENT_TIMEOUT_MS).toBeLessThan(
      CURSOR_TRANSACTION_TIMEOUT_MS,
    )
  })

  it('stops between fetches when the caller has gone', async () => {
    const abort = new AbortController()
    abort.abort()

    await expect(run({ signal: abort.signal })).rejects.toBeInstanceOf(
      AbandonedScanError,
    )
    expect(client.$queryRaw).not.toHaveBeenCalled()
  })

  // 57014 is Postgres cancelling the statement itself, which is the outcome
  // the timeout exists to produce. It has to surface as a classified 504, not
  // as an unattributable 500 — see peopleDb/AGENTS.md.
  it('turns a cancelled fetch into a gateway timeout', async () => {
    client.$queryRaw.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('canceling statement', {
        code: 'P2010',
        clientVersion: 'test',
        meta: { code: '57014' },
      }),
    )

    await expect(run()).rejects.toThrow('took too long')
    expect(logger.error).toHaveBeenCalled()
  })

  it('lets any other failure through untouched', async () => {
    client.$queryRaw.mockRejectedValue(new Error('connection reset'))

    await expect(run()).rejects.toThrow('connection reset')
  })
})
