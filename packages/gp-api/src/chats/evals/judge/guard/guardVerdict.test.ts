import { describe, expect, it } from 'vitest'
import {
  parseAgentOutcomeEntries,
  parseAgentOutcomes,
  resolveGuardVerdict,
} from './guardVerdict'

describe('parseAgentOutcomeEntries', () => {
  it('keeps the agent id beside each outcome', () => {
    const report = [
      "### chief_of_staff — CAN'T SAY",
      '',
      '### campaign_assistant — WORSE',
    ].join('\n')
    expect(parseAgentOutcomeEntries(report)).toEqual([
      { agentId: 'chief_of_staff', outcome: "CAN'T SAY" },
      { agentId: 'campaign_assistant', outcome: 'WORSE' },
    ])
  })
})

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

  // ENG-11593: judge.yml's sweep job (the trusted, AWS-holding step) is the
  // one that reads a baseline and appends this heading to report.md — this
  // guard-side function only has to find and forward it.
  it('appends an already-rendered baseline trailer to a WORSE note', () => {
    const report = [
      '### campaign_assistant — WORSE',
      '',
      'Regression on case-a (upper bound below zero).',
      '',
      '## Guard: main-vs-main baseline',
      '',
      '### campaign_assistant',
      "- `case-a`: main's baseline handled it 2/3 (base) and 2/3 (candidate), flaky on main",
    ].join('\n')
    const verdict = resolveGuardVerdict(report)
    expect(verdict.outcome).toBe('WORSE')
    expect(verdict.note).toContain(
      'WORSE. Flagged for a ruling: `/judge agree` or `/judge dispute <reason>`.',
    )
    expect(verdict.note).toContain('## Guard: main-vs-main baseline')
    expect(verdict.note).toContain('flaky on main')
  })

  it('leaves a WORSE note unchanged when the report carries no baseline trailer', () => {
    const verdict = resolveGuardVerdict('### campaign_assistant — WORSE')
    expect(verdict.outcome).toBe('WORSE')
    expect(verdict.note).toBe(
      'WORSE. Flagged for a ruling: `/judge agree` or `/judge dispute <reason>`.',
    )
  })

  it('never appends a baseline trailer to a non-WORSE note', () => {
    const report = [
      '### chief_of_staff — SAME',
      '',
      '## Guard: main-vs-main baseline',
      '',
      '### chief_of_staff',
      'No main-vs-main baseline for chief_of_staff.',
    ].join('\n')
    const verdict = resolveGuardVerdict(report)
    expect(verdict.outcome).toBe('SAME')
    expect(verdict.note).toBe('SAME.')
  })
})
