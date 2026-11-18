import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import {
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { PrismaService } from '@/prisma/prisma.service'
import { JobsService } from '@/jobs/jobs.service'
import { tableEntries } from '@/jobs/changes.registry'
import { changeGroup, changeJobId } from './dbChangeRows'

// How many unsent rows one pass relays. Small enough that a pass's
// transaction, which holds the rows it read while it inserts their jobs,
// stays short; a backlog clears in a few passes.
const RELAY_BATCH_SIZE = 500

// The pass interval. The relay is the only thing between a committed write
// and its handler, so it is also the delay the relay adds to every one.
const RELAY_INTERVAL_MS = 1_000

// As the email send sweep's lease: one relaying task across the fleet, so two
// tasks never send the same change, and a task that dies mid-pass loses its
// transaction and leaves the rows for the next holder.
const RELAY_LEASE_SECONDS = 30

// A backlog this old is logged as a warning: either the relay has stopped
// draining or a handler is slower than the writes.
const RELAY_BACKLOG_WARN_SECONDS = 300

type Unrelayed = {
  id: bigint
  table_name: string
  row_key: Record<string, unknown>
  waited_seconds: number
}

// A test drives each pass itself rather than letting the loop run, so its
// assertions never race one.
const IS_TEST = process.env.NODE_ENV === 'test'

// Forwards captured writes from the db_change outbox to the queues of the
// handlers that listen to their table (src/jobs/AGENTS.md § Change handlers).
// One transaction per batch: the rows it read are locked and, if it commits,
// stamped relayed_at, and their jobs commit or roll back with them.

@Injectable()
export class DbChangeRelayService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly holder = `${hostname()}-${randomUUID()}`
  private stopped = false
  private loop: Promise<void> | null = null

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(DbChangeRelayService.name)
  }

  onApplicationBootstrap(): void {
    if (IS_TEST) return
    this.loop = this.relay()
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true
    await this.loop
  }

  private async relay(): Promise<void> {
    while (!this.stopped) {
      try {
        await this.relayPass()
      } catch (err) {
        this.logger.error({ err }, 'change relay pass failed')
      }
      if (this.stopped) return
      await new Promise((resolve) => setTimeout(resolve, RELAY_INTERVAL_MS))
    }
  }

  private async hasWork(): Promise<boolean> {
    const [row] = await this.prisma.$queryRaw<Array<{ found: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM db_change WHERE relayed_at IS NULL
      ) AS found
    `
    return row?.found === true
  }

  async relayPass(): Promise<number> {
    // Checked before the lease, so an idle task writes nothing at all.
    if (!(await this.hasWork()) || !(await this.takeLease())) return 0
    try {
      return await this.relayUnsent()
    } finally {
      await this.releaseLease()
    }
  }

  private async relayUnsent(): Promise<number> {
    const byTable = tableEntries()
    let relayed = 0
    for (;;) {
      const batch = await this.relayBatch(byTable)
      relayed += batch.count
      if (batch.count > 0) {
        this.logger.info(
          {
            changes: batch.count,
            tables: batch.tables,
            handlers: batch.handlers,
            oldestWaitedSeconds: batch.oldestWaitedSeconds,
          },
          'change batch relayed',
        )
        if (batch.oldestWaitedSeconds > RELAY_BACKLOG_WARN_SECONDS) {
          this.logger.warn(
            {
              oldestWaitedSeconds: batch.oldestWaitedSeconds,
              changes: batch.count,
            },
            'change outbox backlog',
          )
        }
      }
      // Stops mid-drain on a deploy: the rows it has not read stay unsent,
      // and the next task's pass picks them up.
      if (batch.lostLease || batch.count < RELAY_BATCH_SIZE || this.stopped)
        return relayed
    }
  }

  private async relayBatch(byTable: ReturnType<typeof tableEntries>): Promise<{
    count: number
    tables: number
    handlers: number
    oldestWaitedSeconds: number
    lostLease: boolean
  }> {
    return this.prisma.$transaction(async (tx) => {
      // Renews the lease and holds its row lock until this batch commits. A
      // task taking the lease waits on that lock, so two holders' batches
      // never overlap and one row's changes are never relayed out of order.
      const renewed = await tx.$executeRaw`
        UPDATE db_change_relay
        SET expires_at = now() + make_interval(secs => ${RELAY_LEASE_SECONDS}::int)
        WHERE id = 1 AND holder = ${this.holder}
      `
      if (renewed === 0) {
        return {
          count: 0,
          tables: 0,
          handlers: 0,
          oldestWaitedSeconds: 0,
          lostLease: true,
        }
      }
      const rows = await tx.$queryRaw<Unrelayed[]>`
        SELECT id, table_name, row_key,
          extract(epoch FROM now() - created_at)::float8 AS waited_seconds
        FROM db_change
        WHERE relayed_at IS NULL
        ORDER BY id
        LIMIT ${RELAY_BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      `
      let handlers = 0
      for (const row of rows) {
        for (const entry of byTable.get(row.table_name)?.entries ?? []) {
          await this.jobs.send(
            entry.name,
            { changeId: row.id.toString() },
            {
              group: changeGroup(row.table_name, row.row_key),
              id: changeJobId(row.id, entry.index),
              tx,
            },
          )
          handlers++
        }
      }
      // Stamped whether or not a handler listens now: the trigger captures
      // only the operations a table has an entry for, so a row no entry
      // reads is one whose handler has since been removed, and nothing will
      // ever read it.
      if (rows.length > 0) {
        await tx.$executeRaw`
          UPDATE db_change SET relayed_at = now()
          WHERE id = ANY(${rows.map((row) => BigInt(row.id))}::bigint[])
        `
      }
      return {
        count: rows.length,
        tables: new Set(rows.map((row) => row.table_name)).size,
        handlers,
        oldestWaitedSeconds: Math.round(
          Math.max(0, ...rows.map((row) => Number(row.waited_seconds))),
        ),
        lostLease: false,
      }
    })
  }

  private async takeLease(): Promise<boolean> {
    const taken = await this.prisma.$executeRaw`
      UPDATE db_change_relay
      SET holder = ${this.holder},
          expires_at = now() + make_interval(secs => ${RELAY_LEASE_SECONDS}::int)
      WHERE id = 1
        AND (expires_at IS NULL OR expires_at < now() OR holder = ${this.holder})
    `
    if (taken === 0) await this.warnIfLeaseRowMissing()
    return taken === 1
  }

  // The migration seeds the lease row, so a missing one means someone deleted
  // it, and every pass would return quietly while the outbox filled up.
  private async warnIfLeaseRowMissing(): Promise<void> {
    const [row] = await this.prisma.$queryRaw<Array<{ found: boolean }>>`
      SELECT EXISTS (SELECT 1 FROM db_change_relay WHERE id = 1) AS found
    `
    if (row?.found !== true) {
      this.logger.error('db_change_relay row 1 is missing; nothing relays')
    }
  }

  private async releaseLease(): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE db_change_relay SET expires_at = now()
      WHERE id = 1 AND holder = ${this.holder}
    `
  }
}
