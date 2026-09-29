import { describe, expect, it } from 'vitest'
import {
  formatPlan,
  parseAgentSelector,
  parseArgs,
  run,
  selectAgents,
} from './cli'
import type { AgentEntry } from './agents'

const AGENTS: AgentEntry[] = [
  { agentId: 'chief_of_staff', shape: 'chat', cases: null, status: 'pending' },
  {
    agentId: 'meeting_briefing',
    shape: 'background',
    cases: null,
    status: 'wired',
  },
  {
    agentId: 'briefing_annotation',
    shape: 'chat',
    cases: null,
    status: 'blocked',
    blockedReason: 'no handler yet',
  },
]

describe('parseAgentSelector', () => {
  // A bare `/judge` is the everyday case, so an empty selector means auto
  // rather than everything: `all` is the expensive path and nobody should
  // reach it by omission.
  it.each(['', '   ', 'auto'])('treats %j as auto', (input) => {
    expect(parseAgentSelector(input)).toEqual({ kind: 'auto' })
  })

  it('recognises all', () => {
    expect(parseAgentSelector('all')).toEqual({ kind: 'all' })
  })

  it('parses one id', () => {
    expect(parseAgentSelector('chief_of_staff')).toEqual({
      kind: 'list',
      ids: ['chief_of_staff'],
    })
  })

  it('parses a comma list and trims it', () => {
    expect(parseAgentSelector(' a , b ,')).toEqual({
      kind: 'list',
      ids: ['a', 'b'],
    })
  })
})

describe('selectAgents', () => {
  it('selects everything judgeable for all', () => {
    const result = selectAgents({ kind: 'all' }, AGENTS)
    expect(result.selected.map((a) => a.agentId)).toEqual([
      'chief_of_staff',
      'meeting_briefing',
    ])
    expect(result.blocked.map((a) => a.agentId)).toEqual([
      'briefing_annotation',
    ])
  })

  // A typo in a PR comment should say so rather than quietly run nothing.
  it('reports unknown ids instead of ignoring them', () => {
    const result = selectAgents(
      { kind: 'list', ids: ['chief_of_staff', 'nope'] },
      AGENTS,
    )
    expect(result.unknown).toEqual(['nope'])
    expect(result.selected.map((a) => a.agentId)).toEqual(['chief_of_staff'])
  })

  it('never selects a blocked agent even when named directly', () => {
    const result = selectAgents(
      { kind: 'list', ids: ['briefing_annotation'] },
      AGENTS,
    )
    expect(result.selected).toEqual([])
    expect(result.blocked).toHaveLength(1)
  })

  it('refuses auto in the skeleton, naming who owns it', () => {
    expect(() => selectAgents({ kind: 'auto' }, AGENTS)).toThrow(/trigger/)
  })
})

describe('formatPlan', () => {
  it('names blocked agents with their reason', () => {
    const plan = formatPlan(selectAgents({ kind: 'all' }, AGENTS), AGENTS)
    expect(plan).toContain('briefing_annotation')
    expect(plan).toContain('no handler yet')
  })

  it('lists unknown ids', () => {
    const plan = formatPlan(
      selectAgents({ kind: 'list', ids: ['nope'] }, AGENTS),
      AGENTS,
    )
    expect(plan).toContain('nope')
  })

  // The coverage line is the anti-stall mechanic, so it has to describe the
  // registry it was given. Asserting the exact numbers, because a shape match
  // like /\d+ of \d+/ passes whichever registry it counted and so cannot
  // tell a correct line from one reporting the global list by accident.
  it('reports coverage for the registry it was given', () => {
    const plan = formatPlan(selectAgents({ kind: 'all' }, AGENTS), AGENTS)
    expect(plan).toContain('coverage: 1 of 2 agents wired (1 blocked)')
  })

  it('does not fall back to the real registry', () => {
    const plan = formatPlan(selectAgents({ kind: 'all' }, AGENTS), AGENTS)
    expect(plan).not.toContain('of 20 agents wired')
  })
})

describe('parseArgs', () => {
  it('defaults to auto with no flag', () => {
    expect(parseArgs([])).toEqual({ agents: { kind: 'auto' }, dryRun: false })
  })

  it('reads the agents flag and the dry-run flag', () => {
    expect(parseArgs(['--agents=all', '--dry-run'])).toEqual({
      agents: { kind: 'all' },
      dryRun: true,
    })
  })
})

describe('run', () => {
  it('prints a plan for a dry run', () => {
    expect(run(['--agents=all', '--dry-run']).plan).toContain('coverage:')
  })

  it('threads a caller-supplied registry all the way to the coverage line', () => {
    expect(run(['--agents=all', '--dry-run'], AGENTS).plan).toContain(
      'coverage: 1 of 2 agents wired (1 blocked)',
    )
  })

  it('succeeds on a well-formed request', () => {
    expect(run(['--agents=all', '--dry-run'], AGENTS).exitCode).toBe(0)
  })

  // A typo is a malformed request, not a quiet no-op. Exiting 0 here is how
  // a caller sweeps nothing and reports success.
  it('fails when an id is not an agent', () => {
    const result = run(['--agents=chief_of_staff,typo', '--dry-run'], AGENTS)
    expect(result.exitCode).toBe(1)
    expect(result.plan).toContain('typo')
  })

  // Asking for a blocked agent is a reasonable thing to do and nothing is
  // wrong, so it reports and succeeds.
  it('succeeds when the only match is blocked', () => {
    const result = run(['--agents=briefing_annotation', '--dry-run'], AGENTS)
    expect(result.exitCode).toBe(0)
    expect(result.plan).toContain('briefing_annotation')
  })

  // Failing loudly beats half-running a sweep whose pieces do not exist.
  it('refuses a real run in the skeleton', () => {
    expect(() => run(['--agents=all'])).toThrow(/only --dry-run/)
  })
})
