import { describe, expect, it } from 'vitest'
import { summarise } from './aggregate.js'
import { COMMENT_MARKER, renderComment } from './report.js'
import type { AgentResult, CaseVerdict, RunOutcome, Variant } from './types.js'

const baseline: Variant = { role: 'baseline', ref: 'main', tag: 'main' }
const candidate: Variant = { role: 'candidate', ref: 'pr-42', tag: 'pr_42' }

const verdict = (over: Partial<CaseVerdict> = {}): CaseVerdict => ({
  caseId: 'york_pa',
  winner: 'candidate',
  margin: 'better',
  decidingCriterion: 'source integrity',
  rationale: 'Output 2 cites the city homepage for a specific dollar figure.',
  flipped: false,
  judgeCostUsd: 0.02,
  ...over,
})

const render = (result: AgentResult) =>
  renderComment({
    sections: [{ result, summary: summarise(result) }],
    baseline,
    candidate,
    judgeModel: 'claude-opus-4-7',
    requestedBy: 'swain',
  })

describe('renderComment', () => {
  it('carries the marker the workflow upserts on', () => {
    const body = render({
      agent: 'a',
      verdicts: [verdict()],
      runs: [],
      notes: [],
    })
    expect(body.startsWith(COMMENT_MARKER)).toBe(true)
  })

  it('leads with an overview row per agent', () => {
    const body = render({
      agent: 'find_existing_ordinances',
      verdicts: [verdict()],
      runs: [],
      notes: [],
    })
    expect(body).toMatch(/\| Agent \| Verdict \| W\/T\/L \|/)
    expect(body).toMatch(/\| find_existing_ordinances \|/)
  })

  it('names both refs so the reader knows what was compared', () => {
    const body = render({
      agent: 'a',
      verdicts: [verdict()],
      runs: [],
      notes: [],
    })
    expect(body).toContain('`main`')
    expect(body).toContain('`pr-42`')
  })

  it('escapes pipes so a rationale cannot break the table', () => {
    const body = render({
      agent: 'a',
      verdicts: [verdict({ rationale: 'it said a | b | c in the body' })],
      runs: [],
      notes: [],
    })
    expect(body).toContain('a \\| b \\| c')
  })

  it('flattens newlines out of a rationale', () => {
    const body = render({
      agent: 'a',
      verdicts: [verdict({ rationale: 'first line\nsecond line' })],
      runs: [],
      notes: [],
    })
    expect(body).toContain('first line second line')
  })

  it('shows unstable pairs as unstable rather than as a winner', () => {
    const body = render({
      agent: 'a',
      verdicts: [verdict({ flipped: true, winner: 'tie', margin: 'tie' })],
      runs: [],
      notes: [],
    })
    expect(body).toMatch(/\| york_pa \| unstable \|/)
    expect(body).toMatch(/inconclusive/)
  })

  it('lists failed runs instead of hiding them', () => {
    const runs: RunOutcome[] = [
      {
        caseId: 'ramsey_mn',
        variant: 'candidate',
        status: 'timeout',
        error: 'No artifact after 50 minutes.',
      },
    ]
    const body = render({ agent: 'a', verdicts: [verdict()], runs, notes: [] })
    expect(body).toMatch(/1 run\(s\) failed and were excluded/)
    expect(body).toContain('ramsey_mn')
    expect(body).toContain('No artifact after 50 minutes.')
  })

  it('shows a dash rather than a fake zero when no cost was reported', () => {
    const body = render({
      agent: 'a',
      verdicts: [verdict()],
      runs: [],
      notes: [],
    })
    expect(body).toMatch(/Mean cost per run \| — \| — \|/)
    expect(body).toMatch(/Agent spend: not reported by the runs/)
  })

  it('reports a cost delta with direction and share when both sides reported', () => {
    const runs: RunOutcome[] = [
      { caseId: 'york_pa', variant: 'baseline', status: 'ok', costUsd: 4 },
      { caseId: 'york_pa', variant: 'candidate', status: 'ok', costUsd: 3 },
    ]
    const body = render({ agent: 'a', verdicts: [verdict()], runs, notes: [] })
    expect(body).toMatch(/-\$1\.00 \(-25%\)/)
  })

  it('surfaces notes so caps and cache reuse are visible to the reader', () => {
    const body = render({
      agent: 'a',
      verdicts: [verdict()],
      runs: [],
      notes: ['Capped at 10 cases per agent.'],
    })
    expect(body).toContain('> Capped at 10 cases per agent.')
  })

  it('renders an agent that could not be evaluated at all', () => {
    const body = render({
      agent: 'meeting_briefing',
      verdicts: [],
      runs: [],
      notes: ['This agent could not be evaluated: no golden cases.'],
    })
    expect(body).toMatch(/no result/)
    expect(body).toContain('could not be evaluated')
  })
})
