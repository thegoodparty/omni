import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  formatPlan,
  loadReference,
  parseAgentSelector,
  parseArgs,
  pricingConfig,
  referenceTurns,
  admittedTurns,
  type LoadedReference,
  run,
  selectAgents,
} from './cli'
import { DEFAULT_JUDGE_CONFIG } from './config'
import { estimateAgent, priceAgainstReferences } from './planCost'
import type { AgentEntry } from './agents'

const AGENTS: AgentEntry[] = [
  { agentId: 'chief_of_staff', shape: 'chat', cases: null, status: 'pending' },
  {
    agentId: 'meeting_briefing',
    shape: 'background',
    cases: 'meeting_briefing.json',
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
    expect(plan).toContain(
      'coverage: 1 of 2 agents wired (1 on placeholder inputs, 1 blocked)',
    )
  })

  // race_opponent_summary.json is the one case list not marked placeholder.
  it('leaves the placeholder count out when there is none', () => {
    const agents: AgentEntry[] = [
      {
        agentId: 'race_opponent_summary',
        shape: 'background',
        cases: 'race_opponent_summary.json',
        status: 'wired',
      },
    ]
    const plan = formatPlan(selectAgents({ kind: 'all' }, agents), agents)
    expect(plan.endsWith('coverage: 1 of 1 agents wired')).toBe(true)
  })

  it('does not fall back to the real registry', () => {
    const plan = formatPlan(selectAgents({ kind: 'all' }, AGENTS), AGENTS)
    expect(plan).not.toContain('of 20 agents wired')
  })
})

describe('parseArgs', () => {
  it('defaults to auto with no flag', () => {
    expect(parseArgs([])).toEqual({
      agents: { kind: 'auto' },
      dryRun: false,
      references: [],
    })
  })

  it('reads the agents flag and the dry-run flag', () => {
    expect(parseArgs(['--agents=all', '--dry-run'])).toMatchObject({
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
      'coverage: 1 of 2 agents wired (1 on placeholder inputs, 1 blocked)',
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
    expect(() => run(['--agents=all'])).toThrow(/does not run one/)
  })
})

describe('reference pricing', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'judge-ref-'))
  const file = (name: string, text: string): string => {
    const at = path.join(dir, name)
    writeFileSync(at, text)
    return at
  }
  const agent: AgentEntry = {
    agentId: 'race_opponent_summary',
    shape: 'background',
    cases: 'race_opponent_summary.json',
    status: 'wired',
  }
  const chat: AgentEntry = {
    agentId: 'chief_of_staff',
    shape: 'chat',
    cases: 'chief_of_staff.json',
    status: 'wired',
  }
  const high = file(
    'high.ts',
    'export const estimateAgent = () => ' +
      "({ cents: 99900, basis: 'measured', why: 'ref' })\n",
  )
  const config = file('config.ts', '  attemptsPerCase: 5,\n')
  const cases = path.join(dir, 'cases')
  mkdirSync(cases)
  writeFileSync(
    path.join(cases, 'chief_of_staff.json'),
    JSON.stringify({ cases: [{ turns: ['a', 'b'] }, { question: 'c' }] }),
  )

  it('reads every --reference', () => {
    expect(
      parseArgs(['--reference=a,b,c', '--reference=d,e,f']).references,
    ).toEqual(['a,b,c', 'd,e,f'])
  })

  // A ref whose table prices higher than this branch's wins the row.
  it("loads a ref's estimateAgent, chat attempts and list", async () => {
    const ref = await loadReference(`${high},${config},${cases}`)
    expect(ref.chatAttempts).toBe(5)
    expect(ref.chatTurns(chat)).toBe(3)
    expect(ref.chatTurns(agent)).toBe('unread')
    const plan = run(
      ['--agents=race_opponent_summary', '--dry-run', '--reference=x'],
      [agent],
      [ref],
    ).plan
    expect(plan).toContain('cents: 99900 (measured)')
  })

  it.each([
    ['an empty file', () => file('empty.ts', '')],
    ['a missing file', () => path.join(dir, 'missing.ts')],
    ['a GitHub error body', () => file('404.ts', '{"message": "Not Found"}')],
  ])('leaves the estimate unset for %s', async (_name, at) => {
    expect(
      (await loadReference(`${at()},${config},${cases}`)).estimate,
    ).toBeUndefined()
  })

  it.each([
    ['an empty config', () => file('empty-config.ts', '')],
    ['a missing config', () => path.join(dir, 'nope.ts')],
  ])('leaves the attempts unset for %s', async (_name, at) => {
    expect(
      (await loadReference(`${high},${at()},${cases}`)).chatAttempts,
    ).toBeUndefined()
  })

  it.each(['only-one-part', `${high},${config}`])(
    'reads nothing from the malformed spec %j',
    async (spec) => {
      const ref = await loadReference(spec)
      expect(ref.estimate).toBeUndefined()
      expect(ref.chatAttempts).toBeUndefined()
      expect(ref.chatTurns(chat)).toBe('unread')
    },
  )

  // What the workflow writes: an empty file on a 404, a line that is not a
  // list on any other failure.
  it.each([
    ['', 'absent'],
    ['fetch failed\n', 'unread'],
  ])('reads a list fetched as %j as %s', async (text, read) => {
    const other = path.join(dir, `cases-${read}`)
    mkdirSync(other)
    writeFileSync(path.join(other, 'chief_of_staff.json'), text)
    const ref = await loadReference(`${high},${config},${other}`)
    expect(ref.chatTurns(chat)).toBe(read)
  })

  // Read where the workflow fetched it, under the agent's id, whatever this
  // branch's registry calls the file.
  it("reads a ref's list under the agent id", async () => {
    const ref = await loadReference(`${high},${config},${cases}`)
    expect(ref.chatTurns({ ...chat, cases: 'renamed.json' })).toBe(3)
  })

  // The base arm's longer list is priced, not twice this branch's:
  // (16 + 8) x 3 x $0.123 = $8.86, x1.5 = $13.28, up to $13.50.
  it("prices chat over a ref's longer list", () => {
    const plan = run(
      ['--agents=chief_of_staff', '--dry-run', '--reference=x'],
      [chat],
      [{ estimate: undefined, chatAttempts: 3, chatTurns: () => 16 }],
    ).plan
    expect(plan).toContain('(16 base + 8 candidate turns)')
  })

  // A TRIMMED LIST AND A FAILED FETCH: the base arm could walk any list the
  // budget admits, so it is priced at that ceiling, not at the trim.
  // chief_of_staff plans 20s a turn, so 70 min holds 210 turn-attempts: 70
  // turns at 3 attempts. (70 + 2) x 3 x $0.52 = $112.32, x1.5 = $168.48.
  it('prices an unread ref list at the most turns the arm admits', () => {
    const refs: LoadedReference[] = [
      { estimate: estimateAgent, chatAttempts: 3, chatTurns: () => 9 },
      { estimate: undefined, chatAttempts: 3, chatTurns: () => 'unread' },
    ]
    expect(admittedTurns(chat, 3)).toBe(70)
    expect(referenceTurns(refs, () => 2, 3)(chat)).toBe(70)
    const priced = priceAgainstReferences(refs, DEFAULT_JUDGE_CONFIG, {
      countTurns: () => 2,
      baseTurns: referenceTurns(refs, () => 2, 3),
    })(chat)
    expect(priced).toMatchObject({ cents: 16850, basis: 'base-unread' })
    expect(priced.why).toContain('(70 base + 2 candidate turns)')
  })

  it('wires the ceiling through the CLI', () => {
    const plan = run(
      ['--agents=chief_of_staff', '--dry-run', '--reference=x'],
      [chat],
      [{ estimate: estimateAgent, chatAttempts: 3, chatTurns: () => 'unread' }],
    ).plan
    expect(plan).toContain('(70 base + 8 candidate turns)')
  })

  it('takes the longest list across refs', () => {
    const turns = referenceTurns([
      { estimate: undefined, chatAttempts: 3, chatTurns: () => 4 },
      { estimate: undefined, chatAttempts: 3, chatTurns: () => 9 },
      { estimate: undefined, chatAttempts: 3, chatTurns: () => 'absent' },
    ])
    expect(turns(chat)).toBe(9)
    expect(referenceTurns([])(chat)).toBeUndefined()
  })

  // A PR that points an agent at a new, shorter file: the ref's list was
  // fetched under the agent id, so this branch's count is a floor too.
  it('floors at this branch when its filename differs', () => {
    const renamed = { ...chat, cases: 'short.json' }
    const refs = [
      {
        estimate: undefined,
        chatAttempts: 3,
        chatTurns: () => 'absent' as const,
      },
    ]
    expect(referenceTurns(refs, () => 5)(renamed)).toBe(5)
    expect(referenceTurns(refs, () => 5)(chat)).toBeUndefined()
  })

  // Asked to compare and handed nothing: the worst case, not this branch's.
  it('prices at the worst case when asked for a ref it was not given', () => {
    const plan = run(
      ['--agents=race_opponent_summary', '--dry-run', '--reference=x'],
      [agent],
    ).plan
    expect(plan).toContain('cents: 4800 (base-unread)')
  })

  it('prices from this branch alone when not asked for a ref', () => {
    const plan = run(
      ['--agents=race_opponent_summary', '--dry-run'],
      [agent],
    ).plan
    expect(plan).toContain('cents: 600 (measured)')
  })

  it('prices chat at the largest attempts of every arm', () => {
    expect(pricingConfig([5, 2]).attemptsPerCase).toBe(5)
    expect(pricingConfig([1]).attemptsPerCase).toBe(
      DEFAULT_JUDGE_CONFIG.attemptsPerCase,
    )
    expect(pricingConfig([undefined]).attemptsPerCase).toBe(
      DEFAULT_JUDGE_CONFIG.attemptsPerCase,
    )
  })
})
