import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createLocalRecordStore } from '../records'
import { appendBaselineTrailer } from './appendGuardBaselineTrailerCli'
import { baselineKey, GuardBaselineSchema } from './guardBaseline'
import { writeLedgerObject } from './guardLedger'
import { localGuardLedgerPort } from './guardLedgerStore'

const SLOT_MAP = { X: 'base', Y: 'candidate' } as const
const SWEEP_ID = 'judge-41973696104-1'

const setup = async () => {
  const store = createLocalRecordStore(
    await mkdtemp(path.join(tmpdir(), 'judge-trailer-')),
  )
  const ledgerPort = localGuardLedgerPort(
    await mkdtemp(path.join(tmpdir(), 'judge-trailer-ledger-')),
  )
  return { store, ledgerPort }
}

const REPORT = [
  '## Universal Judge sweep',
  '',
  "### chief_of_staff — CAN'T SAY",
  '',
  '### campaign_assistant — WORSE',
  '',
  'Regression on case-a.',
].join('\n')

describe('appendBaselineTrailer', () => {
  it('returns the verdict map unchanged and the report untouched when nothing is WORSE', async () => {
    const { store, ledgerPort } = await setup()
    const result = await appendBaselineTrailer('### chief_of_staff — SAME', {
      store,
      ledgerPort,
      sweepId: SWEEP_ID,
    })
    expect(result.verdicts).toEqual([
      { agentId: 'chief_of_staff', outcome: 'SAME' },
    ])
    expect(result.baselineRunId).toBeUndefined()
    expect(result.report).toBe('### chief_of_staff — SAME')
  })

  it('appends a trailer naming the moved case for a WORSE agent with a baseline', async () => {
    const { store, ledgerPort } = await setup()
    await store.putRulings({
      sweepId: SWEEP_ID,
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
          handled: { X: 'yes', Y: 'no' },
        },
      ],
    })
    const baseline = GuardBaselineSchema.parse({
      runId: '41973696104',
      agentId: 'campaign_assistant',
      date: '2026-11-05T00:00:00.000Z',
      cases: [
        { caseId: 'case-a', attempts: 3, baseHandled: 3, candidateHandled: 3 },
      ],
      controlPairsCalled: 0,
      controlPairsTotal: 0,
    })
    await writeLedgerObject(
      ledgerPort,
      baselineKey('campaign_assistant'),
      JSON.stringify(baseline),
    )

    const result = await appendBaselineTrailer(REPORT, {
      store,
      ledgerPort,
      sweepId: SWEEP_ID,
    })

    expect(result.verdicts).toEqual([
      { agentId: 'chief_of_staff', outcome: "CAN'T SAY" },
      { agentId: 'campaign_assistant', outcome: 'WORSE' },
    ])
    expect(result.baselineRunId).toBe('41973696104')
    expect(result.report).toContain('## Guard: main-vs-main baseline')
    expect(result.report).toContain('`case-a`')
    expect(result.report).toContain(REPORT)
  })

  it('says there is no baseline for a WORSE agent that never had one', async () => {
    const { store, ledgerPort } = await setup()
    await store.putRulings({
      sweepId: SWEEP_ID,
      agentId: 'campaign_assistant',
      rubricVersion: 'v1',
      judgments: [],
    })

    const result = await appendBaselineTrailer(REPORT, {
      store,
      ledgerPort,
      sweepId: SWEEP_ID,
    })

    expect(result.baselineRunId).toBeUndefined()
    expect(result.report).toContain(
      'No main-vs-main baseline for campaign_assistant',
    )
  })

  it('still reports the verdict map when a WORSE agent has no stored rulings', async () => {
    const { store, ledgerPort } = await setup()
    const result = await appendBaselineTrailer(REPORT, {
      store,
      ledgerPort,
      sweepId: SWEEP_ID,
    })

    expect(result.verdicts).toEqual([
      { agentId: 'chief_of_staff', outcome: "CAN'T SAY" },
      { agentId: 'campaign_assistant', outcome: 'WORSE' },
    ])
    expect(result.report).toContain(
      'No main-vs-main baseline for campaign_assistant',
    )
  })
})
