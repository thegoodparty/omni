import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { statementIdCollector } from './databricks/peopleDbxStatement.client'
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
  statementIds: string[]
  pgError: string | null
}

const DUAL_READ_MESSAGE = 'people-db dual read'

// Postgres is comparison-only in this mode, so it gets a tighter ceiling than
// the 25s a user-facing query gets: a slow shadow must not hold a pooled
// connection open when nothing is waiting on its answer.
export const COMPARISON_STATEMENT_TIMEOUT_MS = 8_000

// Two at a time across the process. The number is the old list-detail gate's
// shape rather than a tuned value: it kept a failing request to a single scan
// family instead of five, and this keeps that property without holding the
// authoritative arm back.
const MAX_CONCURRENT_COMPARISONS = 2

@Injectable()
export class ShadowReadService {
  // PinoLogger, not @nestjs/common's Logger: only Pino's (object, message)
  // signature puts these fields at the top level of the log line, and the
  // whole point of the comparison is being able to aggregate them in LogQL.
  private warnedUnresolved = false
  private comparisonsInFlight = 0
  private readonly comparisonWaiters: Array<() => void> = []

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
  //
  // "Asked for but unresolvable" is a deploy mistake, not a configuration
  // choice, and it is the dangerous one: without this warning it is
  // indistinguishable from "switched off", so a week of intended measurement
  // can pass serving Postgres with nothing but an absence of log lines to show
  // for it. Warned once rather than per request so it cannot flood.
  get enabled(): boolean {
    if (process.env.PEOPLE_DB_DUAL_READ !== 'true') return false
    if (resolvePeopleDbxConfig() !== null) return true
    if (!this.warnedUnresolved) {
      this.warnedUnresolved = true
      this.logger.warn(
        { flag: 'PEOPLE_DB_DUAL_READ' },
        'dual read is enabled but PEOPLE_DATABRICKS_* is unresolved; ' +
          'serving voter reads from people-db Postgres and logging no comparison',
      )
    }
    return false
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
    // Collected per operation, not per statement: `list` issues a count and a
    // page, and an export issues a submit plus its chunk fetches.
    const statementIds: string[] = []
    try {
      const value = await statementIdCollector.run(statementIds, () =>
        args.authoritative(),
      )
      void this.report(
        args,
        performance.now() - startedAt,
        value,
        false,
        comparisonSettled,
        statementIds,
      )
      return value
    } catch (err) {
      void this.report(
        args,
        performance.now() - startedAt,
        null,
        true,
        comparisonSettled,
        statementIds,
      )
      throw err
    }
  }

  // The comparison arm never blocks a response -- compare() awaits only the
  // authoritative side -- so its cost is database load, not latency. That is
  // what this cap protects. It bounds comparisons, not the queries inside one,
  // so a comparison that needs several Postgres statements to answer what
  // Databricks answers in one must run them serially rather than in parallel
  // (getListDetailAggregatesFromPostgres) -- otherwise it multiplies this cap
  // by its own fan-out and defeats it.
  private async timeComparison<C>(
    comparison: () => Promise<C>,
  ): Promise<{ ms: number; value: C | null; error: string | null }> {
    const startedAt = performance.now()
    try {
      const value = await this.withComparisonSlot(comparison)
      return { ms: performance.now() - startedAt, value, error: null }
    } catch (err) {
      return {
        ms: performance.now() - startedAt,
        value: null,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  // Time spent queued counts toward the comparison's measured duration on
  // purpose: pgMs should describe what Postgres would cost under this load, not
  // what one unqueued query costs in isolation.
  private async withComparisonSlot<C>(work: () => Promise<C>): Promise<C> {
    while (this.comparisonsInFlight >= MAX_CONCURRENT_COMPARISONS) {
      await new Promise<void>((resolve) => this.comparisonWaiters.push(resolve))
    }
    this.comparisonsInFlight += 1
    try {
      return await work()
    } finally {
      this.comparisonsInFlight -= 1
      this.comparisonWaiters.shift()?.()
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
    // Explicit rather than inferred from `dbxValue === null`: a nullable A --
    // `findStats` returns null for a district with no voters -- makes a
    // successful empty answer indistinguishable from a thrown error.
    dbxFailed: boolean,
    comparisonSettled: Promise<{
      ms: number
      value: C | null
      error: string | null
    }>,
    statementIds: string[],
  ): Promise<void> {
    const pg = await comparisonSettled
    const dbxPrint =
      dbxFailed || dbxValue === null
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
      // Both null is agreement, not an absent verdict: a district with no
      // voters is the case where the two stores are most likely to disagree
      // (Postgres has no stats row at all, Databricks computes on demand), so
      // it is the one we least want to drop from the measurement.
      agrees: comparable ? dbxPrint === pgPrint : null,
      dbxFailed,
      pgError: pg.error,
      statementIds,
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
