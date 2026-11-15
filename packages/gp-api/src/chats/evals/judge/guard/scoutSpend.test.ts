import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  localScoutSpendPort,
  scoutSpendForMonth,
  scoutSpendOverMonths,
} from './scoutSpend'

const writeRecord = async (
  root: string,
  runId: string,
  spendUsd: number,
): Promise<void> => {
  const dir = path.join(root, 'runs', runId)
  await mkdir(dir, { recursive: true })
  await writeFile(
    path.join(dir, 'record.json'),
    JSON.stringify({ spendUsd: { total: spendUsd } }),
  )
}

describe('localScoutSpendPort', () => {
  it('sums spendUsd.total for every run in a month', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'scout-spend-'))
    await writeRecord(root, '2026-11-01', 1.5)
    await writeRecord(root, '2026-11-15', 2.25)
    await writeRecord(root, '2026-10-30', 9.99) // a different month

    const port = localScoutSpendPort(root)
    const total = await scoutSpendForMonth(port, '2026-11')
    expect(total).toBeCloseTo(3.75)
  })

  it('reports zero for a month with no runs', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'scout-spend-'))
    const port = localScoutSpendPort(root)
    expect(await scoutSpendForMonth(port, '2026-11')).toBe(0)
  })

  it('reports zero when the runs directory was never created', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'scout-spend-'))
    const port = localScoutSpendPort(path.join(root, 'never-made'))
    expect(await scoutSpendForMonth(port, '2026-11')).toBe(0)
  })

  it('treats a run record missing spendUsd as zero, not an error', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'scout-spend-'))
    const dir = path.join(root, 'runs', '2026-11-02')
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, 'record.json'), JSON.stringify({}))
    const port = localScoutSpendPort(root)
    expect(await scoutSpendForMonth(port, '2026-11')).toBe(0)
  })

  it('sums across several months', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'scout-spend-'))
    await writeRecord(root, '2026-11-01', 1)
    await writeRecord(root, '2026-10-01', 2)
    const port = localScoutSpendPort(root)
    const total = await scoutSpendOverMonths(port, ['2026-10', '2026-11'])
    expect(total).toBe(3)
  })
})
