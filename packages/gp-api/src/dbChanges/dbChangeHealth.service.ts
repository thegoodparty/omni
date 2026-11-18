import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { PrismaService } from '@/prisma/prisma.service'
import { capturedTables } from '@/jobs/changes.registry'

// An unsent row this old means the relay has stopped taking the lease. The
// relay's own backlog warning measures a batch it relayed, so it never fires
// when no pass runs at all.
const UNSENT_MAX_AGE_SECONDS = 300

const OPERATION_BITS = [
  { operation: 'insert', bit: 4 },
  { operation: 'update', bit: 16 },
  { operation: 'delete', bit: 8 },
] as const

type DeployedTrigger = {
  table_name: string
  tgtype: number
  enabled: number
  total: number
}

// Checks the capture side of the change pipeline, which nothing else watches:
// a trigger that is missing, disabled or on the wrong table writes nothing, so
// it leaves no backlog, no log line and no dead letter to notice. One error
// line per invariant that does not hold, so `db-change-health-check-failed`
// pages on each (src/jobs/AGENTS.md § Change handlers).
@Injectable()
export class DbChangeHealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(DbChangeHealthService.name)
  }

  async check(): Promise<void> {
    await this.checkCaptureTriggers()
    await this.checkConfig()
    await this.checkRelayRow()
    await this.checkOutbox()
  }

  private async checkCaptureTriggers(): Promise<void> {
    // Matched on the function, not the name, so a trigger renamed or created
    // by hand is checked on what it does. tgenabled is 'O' for one that fires
    // and 'D' for one switched off with ALTER TABLE ... DISABLE TRIGGER, which
    // is silent in exactly the way this whole check exists to catch.
    const rows = await this.prisma.$queryRaw<DeployedTrigger[]>`
      SELECT c.relname AS table_name,
        t.tgtype,
        count(*) FILTER (WHERE t.tgenabled = 'O')::int AS enabled,
        count(*)::int AS total
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND NOT t.tgisinternal
        AND t.tgfoid = 'db_change_capture'::regproc
      GROUP BY c.relname, t.tgtype
    `

    const deployed = new Map<string, { enabled: number; total: number }>()
    for (const row of rows) {
      for (const { operation, bit } of OPERATION_BITS) {
        if (!(row.tgtype & bit)) continue
        const key = `${row.table_name}:${operation}`
        const counts = deployed.get(key) ?? { enabled: 0, total: 0 }
        deployed.set(key, {
          enabled: counts.enabled + row.enabled,
          total: counts.total + row.total,
        })
      }
    }

    for (const { table, operations } of capturedTables()) {
      for (const operation of operations) {
        const key = `${table}:${operation}`
        const counts = deployed.get(key) ?? { enabled: 0, total: 0 }
        deployed.delete(key)
        if (counts.enabled === 1 && counts.total === 1) continue
        this.logger.error(
          {
            table,
            operation,
            enabledTriggers: counts.enabled,
            triggers: counts.total,
          },
          'db change capture trigger missing, disabled or duplicated',
        )
      }
    }

    for (const key of deployed.keys()) {
      const separator = key.lastIndexOf(':')
      this.logger.error(
        { table: key.slice(0, separator), operation: key.slice(separator + 1) },
        'db change capture trigger nothing reads',
      )
    }
  }

  private async checkConfig(): Promise<void> {
    const [row] = await this.prisma.$queryRaw<Array<{ enabled: boolean }>>`
      SELECT enabled FROM db_change_config WHERE id = 1
    `
    if (!row) {
      this.logger.error(
        'db change capture is off: db_change_config row 1 is missing',
      )
      return
    }
    if (!row.enabled) {
      this.logger.error(
        'db change capture is off: db_change_config row 1 is disabled',
      )
    }
  }

  private async checkRelayRow(): Promise<void> {
    const [row] = await this.prisma.$queryRaw<Array<{ found: boolean }>>`
      SELECT EXISTS (SELECT 1 FROM db_change_relay WHERE id = 1) AS found
    `
    if (row?.found !== true) {
      this.logger.error(
        'db change relay is off: db_change_relay row 1 is missing',
      )
    }
  }

  private async checkOutbox(): Promise<void> {
    const [row] = await this.prisma.$queryRaw<
      Array<{ unsent: number; oldest_seconds: number }>
    >`
      SELECT count(*)::int AS unsent,
        coalesce(extract(epoch FROM now() - min(created_at)), 0)::float8
          AS oldest_seconds
      FROM db_change
      WHERE relayed_at IS NULL
    `
    const oldestSeconds = Math.round(row?.oldest_seconds ?? 0)
    if (oldestSeconds <= UNSENT_MAX_AGE_SECONDS) return
    this.logger.error(
      { unsent: row?.unsent ?? 0, oldestUnsentSeconds: oldestSeconds },
      'db change outbox is not draining',
    )
  }
}
