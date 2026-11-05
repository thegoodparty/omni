import { describe, expect, it } from 'vitest'
import { AGENTS } from '../agents'
import { CODE_MAP, codeMapAgentIds } from './codeMap'

describe('the guard code map', () => {
  it('has a row for every agent in the registry', () => {
    const covered = codeMapAgentIds()
    for (const agent of AGENTS) {
      expect(covered.has(agent.agentId), agent.agentId).toBe(true)
    }
  })

  // The regression this guards: an agent added to AGENTS.ts without a
  // matching code-map row would otherwise pass silently, since
  // codeMapAgentIds() only grows. A synthetic, non-redundant map makes the
  // point directly rather than hoping a row in the real map happens to be
  // the only one covering some agent.
  it('fails coverage when an agent has no row at all', () => {
    const covered = codeMapAgentIds(
      [{ path: 'a/', agentIds: ['chief_of_staff'], note: 'x' }],
      ['chief_of_staff', 'campaign_assistant'],
    )
    expect(covered.has('chief_of_staff')).toBe(true)
    expect(covered.has('campaign_assistant')).toBe(false)
  })

  // Delegate review, this story's resume: a row naming literally every
  // registered agent (CODE_MAP's own `llm/` row, correctly, since
  // LlmService is a shared call path) used to make this whole test vacuous —
  // `covered.has(...)` was true for any agent purely because that one
  // catch-all row always lists it, regardless of whether a code-specific row
  // for it exists at all.
  it('does not let a catch-all row alone count as coverage', () => {
    const registry = ['chief_of_staff', 'campaign_assistant']
    const covered = codeMapAgentIds(
      [{ path: 'shared/', agentIds: registry, note: 'catch-all' }],
      registry,
    )
    expect(covered.has('chief_of_staff')).toBe(false)
    expect(covered.has('campaign_assistant')).toBe(false)
  })

  // A coarse row that names more than one agent, but not every registered
  // one, still counts — this is the shape BACKGROUND_AGENT_IDS rows take in
  // the real map, and the fix above must not treat "more than one agent" as
  // the catch-all signal, only "every registered agent".
  it('still counts a coarse row that falls short of every agent', () => {
    const registry = ['chief_of_staff', 'campaign_assistant', 'ordinance_flow']
    const covered = codeMapAgentIds(
      [
        {
          path: 'shared/',
          agentIds: ['chief_of_staff', 'campaign_assistant'],
          note: 'coarse but not total',
        },
      ],
      registry,
    )
    expect(covered.has('chief_of_staff')).toBe(true)
    expect(covered.has('campaign_assistant')).toBe(true)
    expect(covered.has('ordinance_flow')).toBe(false)
  })

  it('every row names a non-empty path and at least one agent', () => {
    for (const row of CODE_MAP) {
      expect(row.path.length).toBeGreaterThan(0)
      expect(row.agentIds.length).toBeGreaterThan(0)
    }
  })
})
