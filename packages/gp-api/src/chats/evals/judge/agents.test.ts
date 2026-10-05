import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AGENTS,
  AgentEntrySchema,
  coverage,
  findAgent,
  requireAgent,
  type AgentEntry,
} from './agents'
import { loadCaseList } from './cases'

const WIRED = {
  agentId: 'x',
  shape: 'chat',
  cases: 'x.json',
  status: 'wired',
  wiredBy: {
    runUrl: 'https://github.com/thegoodparty/omni/actions/runs/123',
    date: '2026-10-02',
  },
} as const

describe('the agent registry', () => {
  it('every entry is valid', () => {
    for (const entry of AGENTS) {
      expect(AgentEntrySchema.safeParse(entry).success, entry.agentId).toBe(
        true,
      )
    }
  })

  it('has no duplicate ids', () => {
    const ids = AGENTS.map((a) => a.agentId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  // The counts are asserted so that adding an agent to the codebase without
  // adding it here fails a test rather than quietly shrinking the
  // denominator the report prints.
  it('covers 5 chat scopes and 16 background experiments', () => {
    const chat = AGENTS.filter((a) => a.shape === 'chat')
    const background = AGENTS.filter((a) => a.shape === 'background')
    expect(chat).toHaveLength(5)
    expect(background).toHaveLength(16)
    expect(AGENTS).toHaveLength(21)
  })

  it('requires a reason on a blocked agent', () => {
    const bad = AgentEntrySchema.safeParse({
      agentId: 'x',
      shape: 'chat',
      cases: null,
      status: 'blocked',
    })
    expect(bad.success).toBe(false)
  })

  it('refuses a reason on an agent that is not blocked', () => {
    const bad = AgentEntrySchema.safeParse({
      agentId: 'x',
      shape: 'chat',
      cases: null,
      status: 'pending',
      blockedReason: 'none of your business',
    })
    expect(bad.success).toBe(false)
  })

  it('accepts a wired agent with its evidence', () => {
    expect(AgentEntrySchema.safeParse(WIRED).success).toBe(true)
  })

  it('refuses a wired agent with no evidence', () => {
    const { wiredBy: _, ...bare } = WIRED
    expect(AgentEntrySchema.safeParse(bare).success).toBe(false)
  })

  it('refuses evidence on an agent that is not wired', () => {
    const bad = AgentEntrySchema.safeParse({ ...WIRED, status: 'pending' })
    expect(bad.success).toBe(false)
  })

  it('refuses a wired agent with no case list', () => {
    const bad = AgentEntrySchema.safeParse({ ...WIRED, cases: null })
    expect(bad.success).toBe(false)
  })

  it.each([
    'https://github.com/thegoodparty/omni/actions/runs/abc',
    'https://github.com/someone-else/omni/actions/runs/123',
    'https://github.com/thegoodparty/omni/pull/123',
    'http://github.com/thegoodparty/omni/actions/runs/123',
    'https://github.com/thegoodparty/omni/actions/runs/123/job/4',
    'xhttps://github.com/thegoodparty/omni/actions/runs/123',
  ])('refuses evidence that is not an omni run URL: %s', (runUrl) => {
    const bad = AgentEntrySchema.safeParse({
      ...WIRED,
      wiredBy: { ...WIRED.wiredBy, runUrl },
    })
    expect(bad.success).toBe(false)
  })

  it('refuses evidence with no real date', () => {
    const bad = AgentEntrySchema.safeParse({
      ...WIRED,
      wiredBy: { ...WIRED.wiredBy, date: 'last week' },
    })
    expect(bad.success).toBe(false)
  })

  // Each one links the live sweep from main that judged its pairs.
  it('marks the three agents a live sweep has judged', () => {
    expect(
      AGENTS.filter((a) => a.status === 'wired').map((a) => [
        a.agentId,
        a.wiredBy,
      ]),
    ).toEqual([
      [
        'chief_of_staff',
        {
          runUrl:
            'https://github.com/thegoodparty/omni/actions/runs/36999748321',
          date: '2026-10-02',
        },
      ],
      [
        'opposition_research',
        {
          runUrl:
            'https://github.com/thegoodparty/omni/actions/runs/37161231631',
          date: '2026-10-03',
        },
      ],
      [
        'race_opponent_summary',
        {
          runUrl:
            'https://github.com/thegoodparty/omni/actions/runs/37355882821',
          date: '2026-10-05',
        },
      ],
    ])
  })

  it('can read the placeholder flag of every wired case list', () => {
    for (const agent of AGENTS.filter((a) => a.status === 'wired')) {
      expect(() => loadCaseList(agent), agent.agentId).not.toThrow()
    }
  })
})

describe('coverage', () => {
  it('excludes blocked agents from the denominator', () => {
    const { wired, judgeable, blocked } = coverage()
    // Named rather than dropped, so each gap stays visible: briefing
    // annotation has no handler yet, and compliance_setup must not be swept
    // at all.
    expect(blocked.map((a) => a.agentId).sort()).toEqual([
      'briefing_annotation',
      'compliance_setup',
    ])
    expect(judgeable).toBe(19)
    expect(wired).toBe(3)
  })

  // chief_of_staff and opposition_research were judged on placeholder case
  // lists, so the line claims nothing about how they do on inputs written to
  // test them. race_opponent_summary ran on Melecia's real bench, so it is the
  // one wired agent the parenthetical does not count.
  it('counts the wired agents that ran on placeholder inputs', () => {
    expect(coverage()).toMatchObject({ wired: 3, placeholder: 2 })
  })

  // THE ONE EXPERIMENT THAT BYPASSES PERMISSION PROMPTS, and the reason this
  // is a control rather than bookkeeping: captureArm skips a blocked agent,
  // so `all` cannot reach it and neither can a request that names it. The
  // assertion is against the manifest rather than a hardcoded list, so an
  // experiment that gains bypassPermissions later fails here instead of
  // quietly becoming sweepable.
  it('blocks every experiment whose manifest bypasses permissions', () => {
    const dir = path.resolve(
      __dirname,
      '../../../../../..',
      'packages/runbooks/experiments',
    )
    const bypassing = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name !== '_schema')
      .filter((e) => {
        const file = path.join(dir, e.name, 'manifest.json')
        if (!existsSync(file)) return false
        const manifest: { permission_mode?: string } = JSON.parse(
          readFileSync(file, 'utf8'),
        )
        return manifest.permission_mode === 'bypassPermissions'
      })
      .map((e) => e.name)

    // Guards the scan: a moved directory would make the rest vacuous.
    expect(bypassing.length).toBeGreaterThan(0)
    for (const agentId of bypassing) {
      const entry = findAgent(agentId)
      expect(entry, `${agentId} is not in the registry`).toBeDefined()
      expect(entry?.status, `${agentId} is sweepable`).toBe('blocked')
    }
  })

  // The flag is what hands an agent the fixture account, so it is pinned to
  // exactly the three that read gp-api: one more is an agent acting as a user
  // it has no need of, one fewer is an agent judged on its empty-data
  // fallback.
  it('marks exactly the three gp-api readers, all sweepable', () => {
    const readers = AGENTS.filter((a) => a.readsGpApi === true)
    expect(readers.map((a) => a.agentId).sort()).toEqual([
      'meeting_briefing',
      'top_community_issues',
      'trending_issues',
    ])
    for (const reader of readers) {
      expect(reader.shape).toBe('background')
      expect(reader.status).toBe('pending')
      expect(reader.cases).toBe(`${reader.agentId}.json`)
    }
  })

  it('counts a wired agent', () => {
    const result = coverage(
      [
        { ...WIRED, agentId: 'a' },
        { agentId: 'b', shape: 'chat', cases: null, status: 'pending' },
      ],
      () => false,
    )
    expect(result).toMatchObject({ wired: 1, placeholder: 0, judgeable: 2 })
  })

  it('splits out the wired agents whose case list is a placeholder', () => {
    const registry: AgentEntry[] = [
      { ...WIRED, agentId: 'real' },
      { ...WIRED, agentId: 'fake' },
      { agentId: 'pending_fake', shape: 'chat', cases: 'x', status: 'pending' },
    ]
    const result = coverage(registry, (a) => a.agentId.endsWith('fake'))
    expect(result).toMatchObject({ wired: 2, placeholder: 1, judgeable: 3 })
  })

  // The default reads the case list itself, not a value the caller passed.
  it('reads the placeholder flag from the case list by default', () => {
    expect(coverage([requireAgent('chief_of_staff')]).placeholder).toBe(1)
    const real = {
      ...requireAgent('race_opponent_summary'),
      status: 'wired',
      wiredBy: WIRED.wiredBy,
    } as const
    expect(coverage([real]).placeholder).toBe(0)
  })

  // One agent's broken list must not fail the plan or report of a sweep
  // that never touches it, so it counts as placeholder instead of throwing.
  it('counts a wired agent whose list will not load as placeholder', () => {
    const broken = {
      ...requireAgent('chief_of_staff'),
      cases: 'no-such-list.json',
    }
    expect(coverage([broken]).placeholder).toBe(1)
  })
})

describe('findAgent', () => {
  it('resolves a registered chat scope', () => {
    expect(findAgent('priority_flow')?.shape).toBe('chat')
  })

  it('returns undefined for an unknown id', () => {
    expect(findAgent('not_an_agent')).toBeUndefined()
  })
})

// The issue route requires `list`, and gp-api's MCP layer rejects a call
// without it before the controller runs. Three instructions once told the
// agent to call it bare, and each silently read an empty feed in production.
describe('every experiment that reads the issue feed', () => {
  it('names a list on each call it tells the agent to make', () => {
    const dir = path.resolve(
      __dirname,
      '../../../../../..',
      'packages/runbooks/experiments',
    )
    const calls = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(dir, e.name, 'instruction.md'))
      .filter((file) => existsSync(file))
      .flatMap((file) =>
        readFileSync(file, 'utf8')
          .split('\n')
          .map((line, index) => ({ at: `${file}:${index + 1}`, line })),
      )
      // Table rows are troubleshooting notes about the tool ("404 → treat
      // as empty"), not calls the agent is told to make.
      .filter(
        ({ line }) =>
          /GET_community_issues|\/v1\/community-issues\b/i.test(line) &&
          !line.trimStart().startsWith('|'),
      )

    expect(calls.length).toBeGreaterThanOrEqual(7)
    // A real enum value, not any prose that happens to contain "list:".
    expect(
      calls
        .filter(
          ({ line }) => !/list(?::\s*"|=)(top_community|trending)\b/.test(line),
        )
        .map(({ at }) => at),
    ).toEqual([])
  })
})
