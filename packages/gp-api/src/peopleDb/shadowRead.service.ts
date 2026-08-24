import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { DatabricksVoterService } from './databricks/databricksVoter.service'
import { resolvePeopleDbxConfig } from './databricks/peopleDbx.config'

// One log line per compared read, at a stable message so a Loki query can
// aggregate a week of them. Flat rather than nested because LogQL cannot
// unwrap nested json without a parser expression per field.
type DualReadLog = {
  op: string
  districtId: string
  dbxMs: number
  pgMs: number | null
  deltaMs: number | null
  ratio: number | null
  dbxFingerprint: string | null
  pgFingerprint: string | null
  agrees: boolean | null
  dbxFailed: boolean
  pgError: string | null
}

const DUAL_READ_MESSAGE = 'people-db dual read'

// Postgres is comparison-only in this mode, so it gets a tighter ceiling than
// the 25s a user-facing query gets: a slow shadow must not hold a pooled
// connection open when nothing is waiting on its answer.
export const COMPARISON_STATEMENT_TIMEOUT_MS = 8_000

@Injectable()
export class ShadowReadService {
  // PinoLogger, not @nestjs/common's Logger: only Pino's (object, message)
  // signature puts these fields at the top level of the log line, and the
  // whole point of the comparison is being able to aggregate them in LogQL.
  constructor(
    private readonly logger: PinoLogger,
    readonly databricks: DatabricksVoterService,
  ) {
    this.logger.setContext(ShadowReadService.name)
  }

  // When on, Databricks serves the request and Postgres runs alongside it for
  // comparison. When off — no flag, or no resolvable credential — callers keep
  // serving from Postgres alone, so an environment without Databricks
  // configured is unaffected rather than broken.
  get enabled(): boolean {
    if (process.env.PEOPLE_DB_DUAL_READ !== 'true') return false
    return resolvePeopleDbxConfig() !== null
  }

  // Returns the DATABRICKS result. Databricks is authoritative here, so its
  // failures propagate: a warehouse outage surfaces as an error rather than
  // silently serving a second store's answer, which is the only way the
  // measurement week tells us whether Databricks alone is production-ready.
  //
  // Postgres is started first so both clocks begin together, then left to
  // settle on its own and never awaited on the response path. A Postgres
  // failure, timeout, or exhausted pool therefore cannot affect what a caller
  // sees or how long they wait for it.
  async compare<A, C>(args: {
    op: string
    districtId: string
    authoritative: () => Promise<A>
    comparison: () => Promise<C>
    fingerprintAuthoritative: (value: A) => string | number | null
    fingerprintComparison: (value: C) => string | number | null
  }): Promise<A> {
    const comparisonSettled = this.timeComparison(args.comparison)
    const startedAt = performance.now()
    try {
      const value = await args.authoritative()
      void this.report(
        args,
        performance.now() - startedAt,
        value,
        comparisonSettled,
      )
      return value
    } catch (err) {
      void this.report(
        args,
        performance.now() - startedAt,
        null,
        comparisonSettled,
      )
      throw err
    }
  }

  private async timeComparison<C>(
    comparison: () => Promise<C>,
  ): Promise<{ ms: number; value: C | null; error: string | null }> {
    const startedAt = performance.now()
    try {
      const value = await comparison()
      return { ms: performance.now() - startedAt, value, error: null }
    } catch (err) {
      return {
        ms: performance.now() - startedAt,
        value: null,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  private async report<A, C>(
    args: {
      op: string
      districtId: string
      fingerprintAuthoritative: (value: A) => string | number | null
      fingerprintComparison: (value: C) => string | number | null
    },
    dbxMs: number,
    dbxValue: A | null,
    comparisonSettled: Promise<{
      ms: number
      value: C | null
      error: string | null
    }>,
  ): Promise<void> {
    const pg = await comparisonSettled
    const dbxFailed = dbxValue === null
    const dbxPrint =
      dbxValue === null
        ? null
        : this.safeFingerprint(dbxValue, args.fingerprintAuthoritative)
    const pgPrint =
      pg.value === null
        ? null
        : this.safeFingerprint(pg.value, args.fingerprintComparison)
    const comparable = pg.error === null && !dbxFailed
    const entry: DualReadLog = {
      op: args.op,
      districtId: args.districtId,
      dbxMs: Math.round(dbxMs),
      pgMs: pg.error === null ? Math.round(pg.ms) : null,
      deltaMs: comparable ? Math.round(pg.ms - dbxMs) : null,
      ratio:
        comparable && dbxMs > 0
          ? Math.round((pg.ms / dbxMs) * 100) / 100
          : null,
      dbxFingerprint: dbxPrint,
      pgFingerprint: pgPrint,
      agrees:
        dbxPrint !== null && pgPrint !== null ? dbxPrint === pgPrint : null,
      dbxFailed,
      pgError: pg.error,
    }
    this.logger.info(entry, DUAL_READ_MESSAGE)
  }

  // A fingerprint is diagnostics, so a bad one must not turn into a failed
  // request or a lost measurement.
  private safeFingerprint<V>(
    value: V,
    fingerprint: (value: V) => string | number | null,
  ): string | null {
    try {
      const print = fingerprint(value)
      return print === null ? null : String(print)
    } catch {
      return null
    }
  }
}
