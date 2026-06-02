import { describe, it, expect } from 'vitest'
import { parseComplianceSummary } from './complianceSummary'

describe('parseComplianceSummary', () => {
  it('extracts the known compliance_setup fields', () => {
    const summary = parseComplianceSummary({
      stage: 'tcr_submitted',
      domain: { name: 'jane-for-mayor.run' },
      tcr_submission: { status: 'pending' },
      blockers_encountered: ['dns_propagation', 'awaiting_pin'],
    })
    expect(summary).toEqual({
      stage: 'tcr_submitted',
      domainName: 'jane-for-mayor.run',
      peerlyStatus: 'pending',
      blockers: ['dns_propagation', 'awaiting_pin'],
    })
  })

  it('leaves unknown or wrongly-typed fields undefined without throwing', () => {
    const summary = parseComplianceSummary({
      stage: 42,
      domain: 'not-an-object',
      tcr_submission: null,
    })
    expect(summary.stage).toBeUndefined()
    expect(summary.domainName).toBeUndefined()
    expect(summary.peerlyStatus).toBeUndefined()
    expect(summary.blockers).toEqual([])
  })

  it('returns an empty blockers array for an empty artifact', () => {
    const summary = parseComplianceSummary({})
    expect(summary.blockers).toEqual([])
    expect(summary.stage).toBeUndefined()
  })

  it('filters non-string entries out of blockers', () => {
    const summary = parseComplianceSummary({
      blockers_encountered: ['real_blocker', 7, null, { nested: true }],
    })
    expect(summary.blockers).toEqual(['real_blocker'])
  })
})
