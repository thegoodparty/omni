import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { DatabricksVoterService } from './databricks/databricksVoter.service'
import { resolvePeopleDbxConfig } from './databricks/peopleDbx.config'

// One log line per compared read, at a stable message so a Loki query can
// aggregate a week of them. Kept flat rather than nested because LogQL cannot
// unwrap nested json without a parser expression per field.
type ShadowLog = {
  op: string
  districtId: string
  pgMs: number
  dbxMs: number | null
  deltaMs: number | null
  ratio: number | null
  pgFingerprint: string | null
  dbxFingerprint: string | null
  agrees: boolean | null
  pgFailed: boolean
  dbxError: string | null
}

const SHADOW_MESSAGE = 'people-db shadow read'

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

  // Off unless explicitly enabled AND the credential resolves, so an
  // environment without Databricks configured cannot start paying for a
  // second read it can't make.
  get enabled(): boolean {
    if (process.env.PEOPLE_DB_SHADOW_READ !== 'true') return false
    return resolvePeopleDbxConfig() !== null
  }

  // Runs both stores against the same request and returns POSTGRES. The
  // shadow read is never awaited on the response path: it is started first so
  // the two measurements begin together, then left to settle and log on its
  // own. A shadow failure, a slow warehouse, or a queued statement therefore
  // cannot change what a caller sees or how long they wait for it.
  //
  // The two stores are separately typed on purpose: Databricks computes
  // district stats where Postgres reads a precomputed row, so their shapes
  // differ and each side gets its own fingerprint.
  async compare<P, S>(args: {
    op: string
    districtId: string
    primary: () => Promise<P>
    shadow: () => Promise<S>
    fingerprintPrimary: (value: P) => string | number | null
    fingerprintShadow: (value: S) => string | number | null
  }): Promise<P> {
    if (!this.enabled) return args.primary()

    const shadowSettled = this.timeShadow(args.shadow)
    const startedAt = performance.now()
    try {
      const value = await args.primary()
      void this.report(
        args,
        performance.now() - startedAt,
        value,
        shadowSettled,
      )
      return value
    } catch (err) {
      void this.report(args, performance.now() - startedAt, null, shadowSettled)
      throw err
    }
  }

  private async timeShadow<S>(
    shadow: () => Promise<S>,
  ): Promise<{ ms: number; value: S | null; error: string | null }> {
    const startedAt = performance.now()
    try {
      const value = await shadow()
      return { ms: performance.now() - startedAt, value, error: null }
    } catch (err) {
      return {
        ms: performance.now() - startedAt,
        value: null,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  private async report<P, S>(
    args: {
      op: string
      districtId: string
      fingerprintPrimary: (value: P) => string | number | null
      fingerprintShadow: (value: S) => string | number | null
    },
    pgMs: number,
    pgValue: P | null,
    shadowSettled: Promise<{
      ms: number
      value: S | null
      error: string | null
    }>,
  ): Promise<void> {
    const dbx = await shadowSettled
    const pgFailed = pgValue === null
    const pgPrint =
      pgValue === null
        ? null
        : this.safeFingerprint(pgValue, args.fingerprintPrimary)
    const dbxPrint =
      dbx.value === null
        ? null
        : this.safeFingerprint(dbx.value, args.fingerprintShadow)
    const comparable = dbx.error === null && !pgFailed
    const entry: ShadowLog = {
      op: args.op,
      districtId: args.districtId,
      pgMs: Math.round(pgMs),
      dbxMs: dbx.error === null ? Math.round(dbx.ms) : null,
      deltaMs: comparable ? Math.round(pgMs - dbx.ms) : null,
      ratio:
        comparable && dbx.ms > 0
          ? Math.round((pgMs / dbx.ms) * 100) / 100
          : null,
      pgFingerprint: pgPrint,
      dbxFingerprint: dbxPrint,
      agrees:
        pgPrint !== null && dbxPrint !== null ? pgPrint === dbxPrint : null,
      pgFailed,
      dbxError: dbx.error,
    }
    this.logger.info(entry, SHADOW_MESSAGE)
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
