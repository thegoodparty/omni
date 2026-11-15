import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createLocalRecordStore, type ArmManifest } from '../records'
import { localGuardLedgerPort } from './guardLedgerStore'
import { readLedgerObject } from './guardLedger'
import { baselineKey } from './guardBaseline'
import {
  parseBaselineArgs,
  runGuardBaseline,
  sweepIdFor,
} from './guardBaselineCli'

const manifest = (arm: 'base' | 'candidate', commit: string): ArmManifest => ({
  schemaVersion: 2,
  sweepId: 'judge-41973696104-1',
  arm,
  ref: 'main',
  commit,
  startedAt: '2026-11-05T00:00:00.000Z',
  endedAt: '2026-11-05T00:10:00.000Z',
  agents: [
    {
      agentId: 'campaign_assistant',
      caseList: 'campaign_assistant.json',
      placeholderCases: false,
      cases: 1,
      attempts: 3,
      recordsWritten: 3,
    },
  ],
  skipped: [],
  spent: true,
})

const setup = async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'judge-baseline-'))
  const store = createLocalRecordStore(dir)
  const ledgerPort = localGuardLedgerPort(
    await mkdtemp(path.join(tmpdir(), 'judge-baseline-ledger-')),
  )
  return { store, ledgerPort }
}

const SLOT_MAP = { X: 'base', Y: 'candidate' } as const

describe('sweepIdFor', () => {
  it('builds the same shape SWEEP_ID the workflow writes', () => {
    expect(sweepIdFor('41973696104')).toBe('judge-41973696104-1')
    expect(sweepIdFor('41973696104', 2)).toBe('judge-41973696104-2')
  })
})

describe('parseBaselineArgs', () => {
  it('reads the runId as the last positional argument', () => {
    expect(parseBaselineArgs(['baseline', '41973696104'])).toEqual({
      runId: '41973696104',
    })
    expect(parseBaselineArgs(['41973696104'])).toEqual({
      runId: '41973696104',
    })
  })

  it('reads --attempt and --agents', () => {
    expect(
      parseBaselineArgs(['41973696104', '--attempt=2', '--agents=a,b']),
    ).toEqual({ runId: '41973696104', attempt: 2, agentIds: ['a', 'b'] })
  })

  it('throws when no positional argument is given', () => {
    expect(() => parseBaselineArgs(['--attempt=2'])).toThrow(/runId/)
  })
})

describe('runGuardBaseline', () => {
  it('refuses when the two arms ran different code', async () => {
    const { store, ledgerPort } = await setup()
    await store.putManifest(manifest('base', 'sha-base'))
    await store.putManifest(manifest('candidate', 'sha-candidate'))
    await store.putRulings({
      sweepId: 'judge-41973696104-1',
      agentId: 'campaign_assistant',
      rubricVersion: 'v1',
      judgments: [],
    })

    const result = await runGuardBaseline({
      runId: '41973696104',
      store,
      ledgerPort,
      codeIsIdentical: async () => false,
    })

    expect(result.written).toEqual([])
    expect(result.refused).toEqual([
      {
        agentId: 'campaign_assistant',
        reason: expect.stringContaining('did not run the same code'),
      },
    ])
  })

  it('writes a baseline file from a no-change sweep’s rulings', async () => {
    const { store, ledgerPort } = await setup()
    await store.putManifest(manifest('base', 'sha-base'))
    await store.putManifest(manifest('candidate', 'sha-candidate-empty-commit'))
    await store.putRulings({
      sweepId: 'judge-41973696104-1',
      agentId: 'campaign_assistant',
      rubricVersion: 'v1',
      judgments: [
        {
          kind: 'graded',
          key: { caseId: 'case-a', attempt: 1, order: 'primary' },
          slotMap: SLOT_MAP,
          dimensions: {},
          seats: [],
          seatFailures: [],
          flags: [],
          absoluteFloor: null,
          handled: { X: 'yes', Y: 'yes' },
        },
      ],
    })

    const result = await runGuardBaseline({
      runId: '41973696104',
      store,
      ledgerPort,
      codeIsIdentical: async () => true,
      now: () => new Date('2026-11-05T12:00:00.000Z'),
    })

    expect(result.refused).toEqual([])
    expect(result.written).toEqual(['campaign_assistant'])

    const written = await readLedgerObject(
      ledgerPort,
      baselineKey('campaign_assistant'),
    )
    expect(written).toBeDefined()
    const parsed = JSON.parse(written ?? '{}')
    expect(parsed.runId).toBe('41973696104')
    expect(parsed.cases).toEqual([
      { caseId: 'case-a', attempts: 1, baseHandled: 1, candidateHandled: 1 },
    ])
  })

  it('skips an agent with no stored rulings rather than throwing', async () => {
    const { store, ledgerPort } = await setup()
    await store.putManifest(manifest('base', 'sha-base'))
    await store.putManifest(manifest('candidate', 'sha-candidate'))

    const result = await runGuardBaseline({
      runId: '41973696104',
      store,
      ledgerPort,
      codeIsIdentical: async () => true,
      agentIds: ['campaign_assistant'],
    })

    expect(result.written).toEqual([])
    expect(result.refused).toEqual([])
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0]?.agentId).toBe('campaign_assistant')
  })
})
