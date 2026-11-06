import { describe, expect, it } from 'vitest'
import { EnvSchema, buildGuardLedgerLine } from './guardLedgerCli'

const NOW = () => new Date('2026-11-05T12:00:00.000Z')

const build = (env: Record<string, string | undefined>) =>
  buildGuardLedgerLine(EnvSchema.parse(env), NOW)

const baseEnv = {
  GUARD_PR_NUMBER: '1234',
  GUARD_HEAD_SHA: 'abc123',
  GUARD_RUN_ID: '41973696104',
  GUARD_AGENTS: 'chief_of_staff',
  GUARD_FLOOR: 'chief_of_staff',
  GUARD_ADDED: '',
  GUARD_VERDICTS: 'chief_of_staff:SAME',
  GUARD_PICKER_STATUS: 'ok',
  GUARD_ESTIMATE_USD: '10',
  GUARD_PICKER_USD: '0.04',
}

describe('buildGuardLedgerLine', () => {
  it('builds a completed line from measured spend (floor-only run)', () => {
    const line = build({
      ...baseEnv,
      GUARD_JOB_STATUS: 'success',
      GUARD_ACTUAL_USD: '9.8',
    })
    expect(line).toMatchObject({
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
    })
  })

  it('builds a picker-expanded line with an added agent', () => {
    const line = build({
      ...baseEnv,
      GUARD_AGENTS: 'chief_of_staff,campaign_assistant',
      GUARD_ADDED: 'campaign_assistant',
      GUARD_VERDICTS: 'chief_of_staff:SAME,campaign_assistant:BETTER',
      GUARD_JOB_STATUS: 'success',
      GUARD_ACTUAL_USD: '15',
    })
    expect(line.agents).toEqual(['chief_of_staff', 'campaign_assistant'])
    expect(line.added).toEqual(['campaign_assistant'])
    expect(line.verdicts).toEqual({
      chief_of_staff: 'SAME',
      campaign_assistant: 'BETTER',
    })
  })

  it('builds a cap-triggered line (picker capped, only the floor ran)', () => {
    const line = build({
      ...baseEnv,
      GUARD_PICKER_STATUS: 'capped',
      GUARD_JOB_STATUS: 'success',
      GUARD_ACTUAL_USD: '9.8',
    })
    expect(line.picker).toBe('capped')
    expect(line.agents).toEqual(['chief_of_staff'])
  })

  it('records the pre-sweep estimate as spendSource "estimate" on a cancelled run with no report', () => {
    const line = build({
      ...baseEnv,
      GUARD_JOB_STATUS: 'cancelled',
      GUARD_ACTUAL_USD: undefined,
    })
    expect(line.status).toBe('cancelled')
    expect(line.spendSource).toBe('estimate')
    expect(line.spendUsd).toBe(10)
  })

  it('maps a failed job status to status "failed"', () => {
    const line = build({
      ...baseEnv,
      GUARD_JOB_STATUS: 'failure',
      GUARD_ACTUAL_USD: undefined,
    })
    expect(line.status).toBe('failed')
    expect(line.spendSource).toBe('estimate')
  })
})
