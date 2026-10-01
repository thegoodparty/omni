import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { AGENTS, AgentEntrySchema, coverage, findAgent } from './agents'

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
})

describe('coverage', () => {
  it('excludes blocked agents from the denominator', () => {
    const { wired, judgeable, blocked } = coverage()
    // Both are named rather than dropped, so the gap stays visible: briefing
    // annotation has no handler yet, and compliance_setup must not be swept
    // at all.
    expect(blocked.map((a) => a.agentId).sort()).toEqual([
      'briefing_annotation',
      'compliance_setup',
    ])
    expect(judgeable).toBe(19)
    expect(wired).toBe(0)
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

  it('counts a wired agent', () => {
    const result = coverage([
      { agentId: 'a', shape: 'chat', cases: 'a.yaml', status: 'wired' },
      { agentId: 'b', shape: 'chat', cases: null, status: 'pending' },
    ])
    expect(result).toMatchObject({ wired: 1, judgeable: 2 })
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
