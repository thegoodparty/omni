import { describe, expect, it } from 'vitest'
import { AGENTS } from '../agents'
import { selectAgents } from '../cli'
import { splitSweepable, unsweepableNote, unsweepableReason } from './sweepable'

describe('unsweepableReason', () => {
  it('refuses compliance_setup, which the sweep path skips as blocked', () => {
    expect(unsweepableReason('compliance_setup')).toBe('blocked')
  })

  it('refuses an id the registry does not know', () => {
    expect(unsweepableReason('not_an_agent')).toBe('not_registered')
  })

  it('agrees with the sweep path on every registered agent', () => {
    const { selected } = selectAgents({ kind: 'all' })
    for (const agent of AGENTS) {
      const sweeps = selected.includes(agent) && agent.cases !== null
      expect(
        unsweepableReason(agent.agentId) === undefined,
        agent.agentId,
      ).toBe(sweeps)
    }
  })
})

describe('splitSweepable', () => {
  it('keeps order and names each agent left out', () => {
    const split = splitSweepable(
      ['campaign_assistant', 'compliance_setup', 'chief_of_staff'],
      (id) => (id === 'compliance_setup' ? 'blocked' : undefined),
    )
    expect(split.sweepable).toEqual(['campaign_assistant', 'chief_of_staff'])
    expect(split.unsweepable).toEqual([
      { agentId: 'compliance_setup', reason: 'blocked' },
    ])
  })
})

describe('unsweepableNote', () => {
  it('is empty when nothing was left out', () => {
    expect(unsweepableNote([])).toBe('')
  })

  it('names each agent with its reason', () => {
    expect(
      unsweepableNote([
        { agentId: 'compliance_setup', reason: 'blocked' },
        { agentId: 'new_agent', reason: 'no_case_list' },
      ]),
    ).toBe(
      ' Not swept, because the judge cannot sweep them: ' +
        '`compliance_setup` (blocked from judging), `new_agent` (no case list).',
    )
  })
})
