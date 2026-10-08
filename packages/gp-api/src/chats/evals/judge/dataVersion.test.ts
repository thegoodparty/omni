import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { DatabricksRowSet } from '@/llm/tools/queryDatabricks.tool'
import {
  currentVersionFrom,
  historySql,
  publishVersion,
  resolveDataVersion,
  serveMartTable,
  type MartHistoryPort,
} from './dataVersion'
import { UnpinnableSqlError } from './deltaVersion'

// STUBBED AT THE CLIENT BOUNDARY, never at the network. The Serve Databricks
// service principal is dead in this checkout (OPError: invalid_client) and
// asking for another credential is not something this repo does, so the one
// call that needs a warehouse is replaced and everything either side of it is
// exercised for real.
const history = (
  ...versions: Array<string | number | bigint | null>
): DatabricksRowSet => ({
  columns: ['version', 'timestamp', 'operation'],
  rows: versions.map((version) => ({
    version,
    timestamp: '2026-09-30T00:00:00Z',
    operation: 'WRITE',
  })),
})

const port = (
  query: (sql: string) => Promise<DatabricksRowSet>,
): { port: MartHistoryPort; closed: () => number } => {
  let closes = 0
  return {
    port: {
      query,
      close: async () => {
        closes += 1
      },
    },
    closed: () => closes,
  }
}

describe('the table the version is resolved for', () => {
  // NOT a literal repeated here. The pin has to be on the table the
  // constituent-data tool is actually allowlisted to read, or it holds still
  // something no agent queries and the report claims a protection nobody got.
  it('is the Serve voter mart, qualified', () => {
    expect(serveMartTable()).toBe(
      'goodparty_data_catalog.mart_serve_agents.serve_agent_voters',
    )
  })

  it('reads the version out of Delta history, not out of the table', () => {
    expect(historySql()).toBe(
      'DESCRIBE HISTORY ' +
        'goodparty_data_catalog.mart_serve_agents.serve_agent_voters',
    )
  })
})

describe('currentVersionFrom', () => {
  it('takes the current version from the history', () => {
    expect(currentVersionFrom(history(3241))).toBe('3241')
  })

  // Databricks documents DESCRIBE HISTORY as reverse-chronological, but a pin
  // that silently took an older version if that ever changed would be worse
  // than no pin: both arms would agree on stale data and nothing would say so.
  it('takes the highest version whatever order the rows arrive in', () => {
    expect(currentVersionFrom(history(3239, 3241, 3240))).toBe('3241')
  })

  // The same integer in the three shapes the driver hands a BIGINT back as.
  it('reads a version the driver returned as a string or a bigint', () => {
    expect(currentVersionFrom(history('3241'))).toBe('3241')
    expect(currentVersionFrom(history(3241n))).toBe('3241')
  })

  it('accepts version zero, which is a table written exactly once', () => {
    expect(currentVersionFrom(history(0))).toBe('0')
  })

  // Refused by assertDeltaVersion rather than by a second regex of its own,
  // because that is the check on splicing the value into a query the
  // agent-facing validator has already passed. A fraction or a negative is
  // not a Delta version, and repairing one would hand the arms a pin nothing
  // held.
  it('refuses a non-integer version', () => {
    expect(() => currentVersionFrom(history('3241.5'))).toThrow(
      UnpinnableSqlError,
    )
  })

  it('refuses a negative version', () => {
    expect(() => currentVersionFrom(history('-1'))).toThrow(UnpinnableSqlError)
    expect(() => currentVersionFrom(history(-1))).toThrow(UnpinnableSqlError)
  })

  it('refuses a version that is not a number at all', () => {
    expect(() => currentVersionFrom(history('latest'))).toThrow(
      UnpinnableSqlError,
    )
  })

  it('refuses a history with no rows', () => {
    expect(() => currentVersionFrom(history())).toThrow(/no rows/)
  })

  it('refuses a history with no readable version column', () => {
    expect(() =>
      currentVersionFrom({
        columns: ['timestamp'],
        rows: [{ timestamp: '2026-09-30T00:00:00Z' }],
      }),
    ).toThrow(/no readable "version" column/)
  })
})

describe('resolveDataVersion', () => {
  it('publishes the version it resolved', async () => {
    const { port: p, closed } = port(async () => history(3241))
    await expect(resolveDataVersion(p)).resolves.toEqual({ version: '3241' })
    expect(closed()).toBe(1)
  })

  it('queries the mart through the history read', async () => {
    const asked: string[] = []
    const { port: p } = port(async (sql) => {
      asked.push(sql)
      return history(1)
    })
    await resolveDataVersion(p)
    expect(asked).toEqual([historySql()])
  })

  // THE FAILURE POLICY. No credential is the ordinary case — most agents
  // never touch the mart — so this returns a reason rather than throwing, and
  // the caller sweeps unpinned. Throwing here would kill a whole paid sweep
  // over a table whose numbers no verdict may even turn on.
  it('yields the unset path, not a throw, with no credential', async () => {
    await expect(resolveDataVersion(null)).resolves.toEqual({
      reason: expect.stringContaining('no Databricks credential'),
    })
  })

  // The live failure this was built against: the Serve service principal
  // returns OPError: invalid_client, which surfaces from inside the driver.
  it('yields the unset path when the credential is dead', async () => {
    const { port: p, closed } = port(() =>
      Promise.reject(new Error('OPError: invalid_client')),
    )
    const resolved = await resolveDataVersion(p)
    expect(resolved.version).toBeUndefined()
    expect(resolved.reason).toContain('invalid_client')
    // Still closed: the driver holds a socket and an unbounded status poller,
    // so a resolver that leaked one would hang the workflow step.
    expect(closed()).toBe(1)
  })

  it('yields the unset path when the history is unusable', async () => {
    const { port: p } = port(async () => history('latest'))
    const resolved = await resolveDataVersion(p)
    expect(resolved.version).toBeUndefined()
    expect(resolved.reason).toContain('not a Delta table version')
  })

  it('yields the unset path when the driver throws a non-Error', async () => {
    const { port: p } = port(() => Promise.reject('warehouse asleep'))
    const resolved = await resolveDataVersion(p)
    expect(resolved.version).toBeUndefined()
    expect(resolved.reason).toContain('warehouse asleep')
  })

  it('does not fail on a close that itself fails', async () => {
    const p: MartHistoryPort = {
      query: async () => history(7),
      close: () => Promise.reject(new Error('socket already gone')),
    }
    await expect(resolveDataVersion(p)).resolves.toEqual({ version: '7' })
  })
})

// WHAT THE WORKFLOW STEP ACTUALLY READS. Not stdout: `@databricks/sql` logs
// `Created DBSQLClient` there on every connect, so a step that captured this
// program's stdout as the version captured driver chatter — and an empty
// result, which is what the failure policy looks like, is exactly the value
// that chatter would hide.
describe('publishVersion', () => {
  const outPath = (): string =>
    path.join(mkdtempSync(path.join(tmpdir(), 'judge-data-version-')), 'v')

  it('publishes a resolved version with nothing around it', () => {
    const out = outPath()
    publishVersion(out, { version: '3241' })
    expect(readFileSync(out, 'utf8')).toBe('3241')
  })

  // Empty, not absent and not a word. The workflow reads this file into a step
  // output and the arms read that into JUDGE_DATA_VERSION, where blank means
  // "not pinned" — so any placeholder here would be spliced into the agent's
  // SQL as a version.
  it('publishes an empty file when the mart could not be pinned', () => {
    const out = outPath()
    publishVersion(out, { reason: 'the credential is dead' })
    expect(readFileSync(out, 'utf8')).toBe('')
  })
})
