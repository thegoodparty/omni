import { describe, expect, it } from 'vitest'
import { parseAgentOutcomes, resolveGuardVerdict } from './guardVerdict'

describe('parseAgentOutcomes', () => {
  it('reads a BETTER heading', () => {
    expect(parseAgentOutcomes('### chief_of_staff — BETTER\n\nbody')).toEqual([
      'BETTER',
    ])
  })

  it('reads a refused heading as an infra error', () => {
    expect(parseAgentOutcomes('### priority_flow — refused\n\nwhy')).toEqual([
      'infra_error',
    ])
  })

  it('reads several agent headings from one report', () => {
    const report = [
      '## Universal Judge sweep',
      '',
      "### chief_of_staff — CAN'T SAY",
      '',
      '### campaign_assistant — WORSE',
      '',
    ].join('\n')
    expect(parseAgentOutcomes(report)).toEqual(["CAN'T SAY", 'WORSE'])
  })

  it('ignores non-agent headings elsewhere in the report', () => {
    const report = [
      '### Arm capture windows',
      '',
      '### chief_of_staff — SAME',
    ].join('\n')
    expect(parseAgentOutcomes(report)).toEqual(['SAME'])
  })

  it('treats an unrecognized label as an infra error rather than dropping it', () => {
    expect(parseAgentOutcomes('### some_agent — not judged')).toEqual([
      'infra_error',
    ])
  })

  it('returns an empty list for a report with no agent heading', () => {
    expect(parseAgentOutcomes('nothing here')).toEqual([])
  })
})

describe('resolveGuardVerdict', () => {
  it('is an infra error with no alert note when the report never arrived', () => {
    const verdict = resolveGuardVerdict(undefined)
    expect(verdict.outcome).toBe('infra_error')
    expect(verdict.conclusion).toBe('neutral')
  })

  it('is an infra error, not a quiet pass, for a report with no agent heading', () => {
    // This path only runs once the cap let agents run, so a report that
    // parses to zero headings means the judging step crashed before writing
    // its summary — never a legitimate "no agent reached".
    const verdict = resolveGuardVerdict('nothing to judge')
    expect(verdict.outcome).toBe('infra_error')
    expect(verdict.conclusion).toBe('neutral')
  })

  it('takes the worst outcome across several agents', () => {
    const report = [
      '### chief_of_staff — BETTER',
      '### campaign_assistant — WORSE',
    ].join('\n')
    const verdict = resolveGuardVerdict(report)
    expect(verdict.outcome).toBe('WORSE')
    expect(verdict.conclusion).toBe('neutral')
  })
})
