import { describe, expect, it } from 'vitest'
import {
  appendLedgerLine,
  ledgerKey,
  monthKeyOf,
  parseLedgerLines,
  readLedgerMonth,
  readLedgerMonths,
  recentMonthKeys,
  sumSpentCentsForPr,
  type GuardLedgerLine,
  type GuardLedgerPort,
} from './guardLedger'

const line = (overrides: Partial<GuardLedgerLine> = {}): GuardLedgerLine => ({
  pr: 1234,
  headSha: 'abc123',
  agents: ['chief_of_staff'],
  floor: ['chief_of_staff'],
  added: [],
  verdicts: { chief_of_staff: 'SAME' },
  spendUsd: 9.8,
  pickerUsd: 0.04,
  status: 'completed',
  spendSource: 'report',
  baselineRunId: null,
  picker: 'ok',
  ruling: null,
  runId: '41973696104',
  recordedAt: '2026-11-05T12:00:00.000Z',
  ...overrides,
})

// A fake port that behaves like a single S3 object, ETags included, so the
// retry loop is exercised for real rather than mocked away.
const fakePort = (): GuardLedgerPort & { calls: number } => {
  const store = new Map<string, { text: string; etag: number }>()
  const state = {
    calls: 0,
    getWithEtag: async (key: string) => {
      const entry = store.get(key)
      return entry === undefined
        ? undefined
        : { text: entry.text, etag: String(entry.etag) }
    },
    putIfMatch: async (key: string, text: string, ifMatch: string | 'NONE') => {
      state.calls++
      const entry = store.get(key)
      const expected = ifMatch === 'NONE' ? undefined : ifMatch
      const actual = entry === undefined ? undefined : String(entry.etag)
      if (actual !== expected) return 'conflict' as const
      const nextEtag = (entry?.etag ?? 0) + 1
      store.set(key, { text, etag: nextEtag })
      return { etag: String(nextEtag) }
    },
  }
  return state
}

describe('ledgerKey / monthKeyOf', () => {
  it('builds the documented path under the role-granted prefix', () => {
    expect(ledgerKey('2026-11')).toBe('_judge/guard/2026-11.jsonl')
  })

  it('derives the month key from an ISO timestamp', () => {
    expect(monthKeyOf('2026-11-05T12:00:00.000Z')).toBe('2026-11')
  })
})

describe('recentMonthKeys', () => {
  it('returns this month plus the requested number before it, newest first', () => {
    expect(recentMonthKeys(new Date('2026-11-05T00:00:00Z'), 3)).toEqual([
      '2026-11',
      '2026-10',
      '2026-09',
    ])
  })
})

describe('appendLedgerLine / readLedgerMonth', () => {
  it('appends exactly one line to the month its recordedAt falls in', async () => {
    const port = fakePort()
    await appendLedgerLine(port, line())
    const lines = await readLedgerMonth(port, '2026-11')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ pr: 1234, status: 'completed' })
  })

  it('appends a second line beside the first rather than overwriting it', async () => {
    const port = fakePort()
    await appendLedgerLine(port, line({ pr: 1 }))
    await appendLedgerLine(port, line({ pr: 2 }))
    const lines = await readLedgerMonth(port, '2026-11')
    expect(lines.map((l) => l.pr)).toEqual([1, 2])
  })

  it('reads an empty array for a month that was never written', async () => {
    const port = fakePort()
    expect(await readLedgerMonth(port, '2026-01')).toEqual([])
  })

  it('reads across several months with readLedgerMonths', async () => {
    const port = fakePort()
    await appendLedgerLine(
      port,
      line({ pr: 1, recordedAt: '2026-10-01T00:00:00.000Z' }),
    )
    await appendLedgerLine(
      port,
      line({ pr: 2, recordedAt: '2026-11-01T00:00:00.000Z' }),
    )
    const lines = await readLedgerMonths(port, ['2026-10', '2026-11'])
    expect(lines.map((l) => l.pr)).toEqual([1, 2])
  })

  it('retries past a conflicting concurrent writer', async () => {
    const port = fakePort()
    // Simulate another run's successful write landing between this
    // append's read and write by racing the write once.
    const realPut = port.putIfMatch.bind(port)
    let first = true
    port.putIfMatch = async (key, text, ifMatch) => {
      if (first) {
        first = false
        await realPut(key, `${JSON.stringify(line({ pr: 999 }))}\n`, ifMatch)
        return 'conflict'
      }
      return realPut(key, text, ifMatch)
    }
    await appendLedgerLine(port, line({ pr: 1234 }))
    const lines = await readLedgerMonth(port, '2026-11')
    expect(lines.map((l) => l.pr).sort((a, b) => a - b)).toEqual([999, 1234])
  })

  it('rejects a line that fails the schema before ever touching the port', async () => {
    const port = fakePort()
    await expect(appendLedgerLine(port, line({ pr: -1 }))).rejects.toThrow()
  })
})

describe('parseLedgerLines', () => {
  it('parses one object per non-empty line', () => {
    const jsonl = `${JSON.stringify(line({ pr: 1 }))}\n${JSON.stringify(
      line({ pr: 2 }),
    )}\n`
    expect(parseLedgerLines('test', jsonl).map((l) => l.pr)).toEqual([1, 2])
  })

  it('throws, naming the file, on a line that is not valid JSON', () => {
    expect(() => parseLedgerLines('guard/2026-11.jsonl', 'not json')).toThrow(
      /guard\/2026-11\.jsonl/,
    )
  })
})

describe('sumSpentCentsForPr', () => {
  it('counts only this PR’s lines across months, cancelled and completed alike', () => {
    const lines = [
      line({
        pr: 1234,
        spendUsd: 9.8,
        pickerUsd: 0.04,
        recordedAt: '2026-10-01T00:00:00.000Z',
      }),
      line({
        pr: 1234,
        spendUsd: 5,
        pickerUsd: 0,
        status: 'cancelled',
        spendSource: 'estimate',
        recordedAt: '2026-11-01T00:00:00.000Z',
      }),
      line({
        pr: 9999,
        spendUsd: 100,
        pickerUsd: 0,
        recordedAt: '2026-11-02T00:00:00.000Z',
      }),
    ]
    // (9.80 + 0.04 + 5.00) * 100 = 1484, rounded per line to avoid float
    // drift: 984 + 500 = 1484.
    expect(sumSpentCentsForPr(lines, 1234)).toBe(1484)
    expect(sumSpentCentsForPr(lines, 9999)).toBe(10000)
    expect(sumSpentCentsForPr(lines, 1)).toBe(0)
  })
})
