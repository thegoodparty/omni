import { describe, expect, it } from 'vitest'
import { AgentsService } from './agents.service'
import type { AgentRuntime } from './types'

const validInput = {
  organizationSlug: 'eo-test',
  electedOfficeId: 'office-1',
  requestedAt: '2026-11-13T10:00:00Z',
  officialName: 'Rowan Ledbetter',
  state: 'NC',
  meetingDate: '2026-09-03',
}

describe('AgentsService', () => {
  it('validates the input against the agent before handing it to the engine', async () => {
    const calls: unknown[][] = []
    const runtime: AgentRuntime = {
      run: async (...args) => {
        calls.push(args)
        return { runId: 'run-1' }
      },
      getRun: async () => {
        throw new Error('unused')
      },
    }
    const agents = new AgentsService(runtime)
    const replay = { mode: 'replay' as const, key: '_judge/replay/x' }

    await expect(
      agents.run('meetingBriefing', validInput, { judgeReplay: replay }),
    ).resolves.toEqual({ runId: 'run-1' })
    expect(calls).toEqual([
      ['meetingBriefing', validInput, { judgeReplay: replay }],
    ])

    await expect(
      agents.run('meetingBriefing', { ...validInput, state: 'North Carolina' }),
    ).rejects.toThrow()
    expect(calls).toHaveLength(1)
  })

  it('says no engine is bound when none is', async () => {
    await expect(
      new AgentsService().run('meetingBriefing', validInput),
    ).rejects.toThrow(/No agent engine/)
  })
})
