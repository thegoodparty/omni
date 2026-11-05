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
    const covered = codeMapAgentIds([
      { path: 'a/', agentIds: ['chief_of_staff'], note: 'x' },
    ])
    expect(covered.has('chief_of_staff')).toBe(true)
    expect(covered.has('campaign_assistant')).toBe(false)
  })

  it('every row names a non-empty path and at least one agent', () => {
    for (const row of CODE_MAP) {
      expect(row.path.length).toBeGreaterThan(0)
      expect(row.agentIds.length).toBeGreaterThan(0)
    }
  })
})
