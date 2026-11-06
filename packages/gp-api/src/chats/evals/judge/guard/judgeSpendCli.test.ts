import { describe, expect, it } from 'vitest'
import {
  appendLedgerLine,
  type GuardLedgerLine,
  type GuardLedgerPort,
} from './guardLedger'
import { localGuardLedgerPort } from './guardLedgerStore'
import { localScoutSpendPort, type ScoutSpendPort } from './scoutSpend'
import { formatSpendReport, guardSpendCents, sumSpend } from './judgeSpendCli'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const emptyScoutPort = (): ScoutSpendPort => ({
  listRunIds: async () => [],
  readRunRecord: async () => undefined,
})

const LINE: GuardLedgerLine = {
  pr: 1,
  headSha: 'a'.repeat(40),
  agents: ['chief_of_staff'],
  floor: ['chief_of_staff'],
  added: [],
  verdicts: { chief_of_staff: 'SAME' },
  spendUsd: 10,
  pickerUsd: 0.5,
  status: 'completed',
  spendSource: 'report',
  baselineRunId: null,
  picker: 'ok',
  ruling: null,
  runId: 'judge-1-1',
  recordedAt: '2026-11-05T00:00:00.000Z',
}

describe('guardSpendCents', () => {
  it('sums spendUsd and pickerUsd across every PR, not just one', () => {
    const other: GuardLedgerLine = { ...LINE, pr: 2, spendUsd: 1, pickerUsd: 0 }
    expect(guardSpendCents([LINE, other])).toBe(1050 + 100)
  })

  it('is zero for an empty ledger', () => {
    expect(guardSpendCents([])).toBe(0)
  })
})

describe('sumSpend', () => {
  it('reports zero for both ledgers when nothing was ever written', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'judge-ledger-'))
    const totals = await sumSpend(
      localGuardLedgerPort(root),
      emptyScoutPort(),
      ['2026-11'],
    )
    expect(totals).toEqual({ scoutUsd: 0, guardUsd: 0, totalUsd: 0 })
  })

  it('sums fixture totals from both the guard ledger and the scout runs', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'judge-ledger-'))
    const port: GuardLedgerPort = localGuardLedgerPort(root)
    await appendLedgerLine(port, LINE)

    const scoutRoot = await mkdtemp(path.join(tmpdir(), 'scout-spend-'))
    const dir = path.join(scoutRoot, 'runs', '2026-11-05')
    await mkdir(dir, { recursive: true })
    await writeFile(
      path.join(dir, 'record.json'),
      JSON.stringify({ spendUsd: { total: 4.25 } }),
    )

    const totals = await sumSpend(port, localScoutSpendPort(scoutRoot), [
      '2026-11',
    ])
    expect(totals.guardUsd).toBeCloseTo(10.5)
    expect(totals.scoutUsd).toBeCloseTo(4.25)
    expect(totals.totalUsd).toBeCloseTo(14.75)
  })

  it('reports zero for a missing ledger month rather than throwing', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'judge-ledger-'))
    const totals = await sumSpend(
      localGuardLedgerPort(root),
      emptyScoutPort(),
      ['2099-01'],
    )
    expect(totals.guardUsd).toBe(0)
  })
})

describe('formatSpendReport', () => {
  it('prints month-to-date and the trailing-window grand total for both ledgers', () => {
    const text = formatSpendReport(
      { scoutUsd: 1, guardUsd: 2, totalUsd: 3 },
      { scoutUsd: 10, guardUsd: 20, totalUsd: 30 },
      12,
    )
    expect(text).toContain('Month to date:')
    expect(text).toContain('scout:  $1.00')
    expect(text).toContain('guard:  $2.00')
    expect(text).toContain('total:  $3.00')
    expect(text).toContain('Trailing 12 months')
    expect(text).toContain('total:  $30.00')
  })
})
