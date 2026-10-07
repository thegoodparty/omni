import { writeFileSync } from 'node:fs'
import {
  CONSTITUENT_CATALOG,
  CONSTITUENT_SCHEMA,
  CONSTITUENT_TABLES,
} from '@/chats/general/chief-of-staff/services/constituentDataScope'
import { resolveDatabricksConnection } from '@/llm/tools/databricksConnection'
import { DatabricksSqlProvider } from '@/llm/tools/databricksProvider'
import type { DatabricksRowSet } from '@/llm/tools/queryDatabricks.tool'
import { assertDeltaVersion } from './runners/chatSeam'

// THE ONE DELTA VERSION BOTH ARMS READ, resolved before either of them runs.
//
// `JUDGE_DATA_VERSION` is what pins the voter mart: `pinDeltaVersion` rewrites
// every allowlisted table reference to `VERSION AS OF <n>`, so a verdict can
// never be an artifact of the voter data moving between the two captures.
// That is the one input a comparison cannot hold still by re-running, because
// the arms are two processes in two checkouts and the second can start an hour
// after the first finished.
//
// RESOLVED HERE AND NOT INSIDE AN ARM, which is the whole reason this is a
// separate program rather than a line in the runner. An arm that looked up
// "current" itself would be two lookups an hour apart and would get two
// answers — the exact skew the pin exists to remove. One process resolves it,
// the workflow publishes it as a step output, and both arms read that one
// value.
//
// The address comes from the app-layer allowlist rather than from a literal
// here: `CONSTITUENT_TABLES` is the approved surface the constituent-data tool
// is handed, and the catalog/schema pair is the one the scope handlers build
// their provider against. A pin on a table the agent does not read protects
// nothing, and would look identical in the report to one that does.

export class DataVersionError extends Error {}

// Qualified, not the bare name the provider's `USE CATALOG` / `USE SCHEMA`
// would resolve. This program opens its own session, and a warehouse default
// that quietly differs is not something to discover from a
// TABLE_OR_VIEW_NOT_FOUND on the mart.
//
// A function rather than a constant so an empty allowlist is a refusal the
// caller turns into "not pinned", not a module that throws on import or,
// worse, a `DESCRIBE HISTORY catalog.schema.` that a vendor error explains
// badly.
export const serveMartTable = (): string => {
  const [first] = CONSTITUENT_TABLES
  if (first === undefined) {
    throw new DataVersionError(
      'the constituent-data allowlist names no table, so there is nothing ' +
        'whose version could be pinned',
    )
  }
  return `${CONSTITUENT_CATALOG}.${CONSTITUENT_SCHEMA}.${first.table}`
}

// Delta's own commit log. The current version is the newest entry in it, and
// this is the only read of it that does not also scan the table.
export const historySql = (): string => `DESCRIBE HISTORY ${serveMartTable()}`

const VERSION_COLUMN = 'version'

// The driver hands a Delta version back as whatever the column's JDBC type
// maps to, which for a BIGINT is a number on some driver versions and a
// bigint or a decimal string on others. All three are the same integer, so
// they are normalised to the decimal string `VERSION AS OF` takes rather than
// having two of them read as unresolvable.
const asVersionString = (value: unknown): string | null => {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) ? value.toString() : null
  }
  return null
}

// The HIGHEST version in the history, not the first row. Databricks documents
// `DESCRIBE HISTORY` as reverse-chronological, but a pin that silently took an
// older version if that ever changed would be worse than no pin at all: both
// arms would agree on stale data and nothing in the report would say so.
// Taking the maximum is order-independent and costs one pass.
export const currentVersionFrom = (rows: DatabricksRowSet): string => {
  if (rows.rows.length === 0) {
    throw new DataVersionError(
      'DESCRIBE HISTORY on the voter mart returned no rows, so there is no ' +
        'Delta history to pin to: either the table is not a Delta table or ' +
        'this credential cannot see its history',
    )
  }
  let best: { version: string; value: number } | null = null
  for (const row of rows.rows) {
    const raw = asVersionString(row[VERSION_COLUMN])
    if (raw === null) continue
    // Checked with `assertDeltaVersion` rather than a second regex of its
    // own. That is the guard on splicing this string into a query the
    // agent-facing validator has already passed, so it has to be the same
    // check that accepts the value here — otherwise the two drift and the pin
    // fails at the first query the agent writes, mid-sweep, after the money
    // is spent.
    assertDeltaVersion(raw)
    const value = Number.parseInt(raw, 10)
    if (best === null || value > best.value) best = { version: raw, value }
  }
  if (best === null) {
    throw new DataVersionError(
      `DESCRIBE HISTORY returned ${rows.rows.length} row(s) but no readable ` +
        `"${VERSION_COLUMN}" column, so there is no version to pin to`,
    )
  }
  return best.version
}

// The one seam this program is stubbed at. No live Serve credential exists
// locally, so the network call is replaced in tests and everything either side
// of it is exercised for real.
export interface MartHistoryPort {
  query: (sql: string) => Promise<DatabricksRowSet>
  close: () => Promise<void>
}

// Null, not a throw, when nothing is configured. A job with no Databricks
// credential is the ordinary case — most agents never touch the mart — and the
// policy is to sweep unpinned rather than to refuse.
export const martHistoryPort = (): MartHistoryPort | null => {
  const conn = resolveDatabricksConnection()
  if (!conn) return null
  const provider = new DatabricksSqlProvider({
    ...conn,
    catalog: CONSTITUENT_CATALOG,
    schema: CONSTITUENT_SCHEMA,
  })
  return {
    query: (sql) => provider.query(sql),
    close: () => provider.close(),
  }
}

export interface ResolvedDataVersion {
  // Absent when the mart could not be pinned. The sweep then proceeds
  // unpinned and the report says so.
  version?: string
  // Why there is no version, in one sentence, for the workflow's warning
  // annotation. Absent exactly when `version` is present.
  reason?: string
}

export const resolveDataVersion = async (
  port: MartHistoryPort | null = martHistoryPort(),
): Promise<ResolvedDataVersion> => {
  if (port === null) {
    return {
      reason:
        'no Databricks credential is configured for this job, so the voter ' +
        'mart cannot be read at all',
    }
  }
  try {
    return { version: currentVersionFrom(await port.query(historySql())) }
  } catch (err) {
    // EVERY failure lands here on purpose: a dead credential, a revoked grant
    // on the history, a warehouse that will not resume, a vendor string
    // nobody predicted. The caller's decision is the same for all of them —
    // sweep unpinned and say so — and a class-by-class handler would only add
    // a way for one of them to escape and kill a paid sweep.
    return {
      reason:
        "the mart's Delta history could not be read: " +
        (err instanceof Error ? `${err.name}: ${err.message}` : String(err)),
    }
  } finally {
    // The driver holds a live socket and an unbounded status poller, so a
    // program that resolved its version and did not close would hang the very
    // workflow step it exists to serve.
    await port.close().catch(() => undefined)
  }
}

// PUBLISHED TO A FILE, NOT TO STDOUT, and that is a correctness fix rather
// than a preference. `@databricks/sql` logs `Created DBSQLClient` and
// `initializing thrift client` to stdout on every connect, so a workflow step
// that captured this program's stdout as the version captured four lines of
// driver chatter instead — and an empty file, which is what "could not be
// resolved" has to look like, is the one value that chatter would hide.
//
// Empty on failure rather than absent: the caller reads the file
// unconditionally, so a missing one would be a second failure mode to handle
// for no gain.
export const publishVersion = (
  outPath: string,
  resolved: ResolvedDataVersion,
): void => {
  writeFileSync(outPath, resolved.version ?? '', 'utf8')
}

// EXIT 0 EITHER WAY, which is the failure policy rather than an oversight.
// Most agents in a sweep never touch the mart, so killing a whole paid sweep
// over an unpinnable table would be the wrong trade — and proceeding silently,
// as though pinned, would be worse. So: the version in the named file when
// there is one and an EMPTY file when there is not, the reason on stderr, and
// the workflow turns an empty file into a warning annotation and an unset
// `JUDGE_DATA_VERSION`. The report names it again beside any verdict whose
// runs actually queried the mart.
export const main = async (
  argv: readonly string[] = process.argv.slice(2),
): Promise<void> => {
  const [outPath] = argv
  if (outPath === undefined || outPath === '') {
    throw new DataVersionError(
      'name the file to write the resolved version to: ' +
        'npx tsx dataVersion.ts <path>',
    )
  }
  const resolved = await resolveDataVersion()
  publishVersion(outPath, resolved)
  process.stderr.write(
    resolved.version === undefined
      ? 'the voter mart is NOT pinned for this sweep: ' +
          `${resolved.reason ?? 'no reason was given'}\n`
      : `the voter mart is pinned to Delta version ${resolved.version}\n`,
  )
}

// gp-api is CommonJS, so `require.main` is the house pattern rather than
// import.meta — see the same guard at the foot of sweep.ts.
if (require.main === module) {
  // NO STACK AND NO NON-ZERO EXIT, even here. `resolveDataVersion` already
  // turns every expected failure into a reason, so anything reaching this
  // catch is unexpected — and an unexpected failure in the one step that is
  // allowed to come back empty must still not take a paid sweep down with it.
  main().catch((err: unknown) => {
    process.stderr.write(
      'the voter mart is NOT pinned for this sweep: the resolver itself ' +
        `failed \u2014 ${err instanceof Error ? err.message : String(err)}\n`,
    )
  })
}
