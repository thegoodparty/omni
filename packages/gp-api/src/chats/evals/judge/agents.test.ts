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
    // Briefing annotation has no handler yet, so it cannot be judged. It is
    // named rather than dropped so the gap stays visible.
    expect(blocked.map((a) => a.agentId)).toEqual(['briefing_annotation'])
    expect(judgeable).toBe(20)
    expect(wired).toBe(0)
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
